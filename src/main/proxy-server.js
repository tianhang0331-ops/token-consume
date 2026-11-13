'use strict';

const http = require('node:http');
const https = require('node:https');
const { getProvider, hasProvider, listProviders } = require('../shared/providers');
const { createStreamCollector, estimateTokens, extractUsage } = require('../shared/usage-parser');

const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers':
    'authorization, content-type, x-api-key, api-key, anthropic-version, anthropic-beta, x-goog-api-key, openai-beta, openai-organization, openai-project, x-token-consume-provider, x-token-consume-base-url'
};

const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;

function requestKind(pathname) {
  if (/\/(chat\/completions)$/.test(pathname)) return 'openai-chat';
  if (/\/(responses)$/.test(pathname)) return 'openai-responses';
  if (/\/(messages)$/.test(pathname)) return 'anthropic-messages';
  if (/\/models\/[^/:]+:(generateContent|streamGenerateContent)$/.test(pathname)) return 'gemini';
  return 'generic';
}

function joinUpstream(base, incomingPath, incomingSearch) {
  const baseUrl = new URL(base);
  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  let suffix = incomingPath || '/';
  if (basePath && suffix.startsWith(`${basePath}/`)) {
    suffix = suffix.slice(basePath.length);
  }
  const fullPath = `${basePath}${suffix}`.replace(/\/{2,}/g, '/') || '/';
  return {
    protocol: baseUrl.protocol,
    hostname: baseUrl.hostname,
    port: baseUrl.port || (baseUrl.protocol === 'https:' ? 443 : 80),
    path: `${fullPath}${incomingSearch || ''}`,
    href: `${baseUrl.origin}${fullPath}${incomingSearch || ''}`
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    ...CORS_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length
  });
  res.end(body);
}

function sanitizeBaseUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function createMeterProxy({ getSettings, onUsage, appVersion = '0.0.0', logger = console, allowBaseUrlOverride = false }) {
  let server = null;
  let listeningPort = 0;
  let startedAt = null;
  const sockets = new Set();
  const stats = {
    requests: 0,
    metered: 0,
    failed: 0,
    estimated: 0,
    lastRequestAt: null,
    lastError: ''
  };

  function resolveTarget(request) {
    const settings = getSettings();
    const requested = String(request.headers['x-token-consume-provider'] || '').trim();
    const providerId = hasProvider(requested) ? requested : settings.provider;
    const provider = getProvider(providerId);
    const override = allowBaseUrlOverride ? sanitizeBaseUrl(request.headers['x-token-consume-base-url']) : null;
    return { provider, baseUrl: override || provider.apiBase };
  }

  function captureText(current, chunk) {
    if (current.length >= MAX_CAPTURE_BYTES) return current;
    return current + chunk.toString('utf8');
  }

  async function finalizeMetering({ kind, provider, requestBody, responseBody, usage, statusCode, pathModel = '' }) {
    if (statusCode >= 400) return;
    if (kind === 'generic') return;

    let requestText = '';
    try {
      requestText = requestBody ? requestBody.toString('utf8') : '';
    } catch {
      requestText = '';
    }

    let model = '';
    try {
      const parsedRequest = requestText ? JSON.parse(requestText) : null;
      model = parsedRequest && typeof parsedRequest.model === 'string' ? parsedRequest.model : '';
    } catch {
      model = '';
    }

    let finalUsage = usage;
    let estimated = Boolean(finalUsage && finalUsage.estimated);

    if (!finalUsage) {
      const inputTokens = estimateTokens(requestText);
      const outputTokens = estimateTokens(responseBody);
      if (!inputTokens && !outputTokens) return;
      finalUsage = {
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      };
      estimated = true;
    } else if (estimated && !finalUsage.inputTokens) {
      finalUsage.inputTokens = estimateTokens(requestText);
    }

    const resolvedModel = finalUsage.model || model || pathModel || provider.defaultModel;

    try {
      await onUsage({
        providerId: provider.id,
        model: resolvedModel,
        inputTokens: finalUsage.inputTokens,
        outputTokens: finalUsage.outputTokens,
        cacheReadTokens: finalUsage.cacheReadTokens,
        cacheWriteTokens: finalUsage.cacheWriteTokens,
        estimated,
        source: 'proxy'
      });
      stats.metered += 1;
      if (estimated) stats.estimated += 1;
    } catch (error) {
      stats.lastError = error instanceof Error ? error.message : String(error);
      logger.error('[proxy] failed to record usage:', stats.lastError);
    }
  }

  function forwardRequest({ method, target, headers, body }) {
    return new Promise((resolve, reject) => {
      const client = target.protocol === 'https:' ? https : http;
      const upstreamReq = client.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          path: target.path,
          method,
          headers,
          timeout: UPSTREAM_TIMEOUT_MS
        },
        resolve
      );

      upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('Upstream request timed out')));
      upstreamReq.on('error', reject);
      if (body && body.length) upstreamReq.write(body);
      upstreamReq.end();
    });
  }

  async function handleProxy(req, res) {
    stats.requests += 1;
    stats.lastRequestAt = new Date().toISOString();

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: { message: 'Only POST requests can be metered. Use GET /health for status.', type: 'token_consume_error' } });
      return;
    }

    const incomingUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const kind = requestKind(incomingUrl.pathname);
    const { provider, baseUrl } = resolveTarget(req);
    const target = joinUpstream(baseUrl, incomingUrl.pathname, incomingUrl.search);

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower) || lower === 'accept-encoding') continue;
      if (lower.startsWith('x-token-consume-')) continue;
      headers[key] = value;
    }
    headers['accept-encoding'] = 'identity';

    const body = await readBody(req);
    headers['content-length'] = String(body.length);

    let upstreamRes;
    try {
      upstreamRes = await forwardRequest({ method: 'POST', target, headers, body });
    } catch (error) {
      stats.failed += 1;
      stats.lastError = error instanceof Error ? error.message : String(error);
      sendJson(res, 502, { error: { message: `无法连接上游服务：${stats.lastError}`, type: 'upstream_error' } });
      return;
    }

    const statusCode = upstreamRes.statusCode || 502;
    const contentType = String(upstreamRes.headers['content-type'] || '');
    const encoding = String(upstreamRes.headers['content-encoding'] || '').toLowerCase();
    const parseable = !encoding || encoding === 'identity';
    const streaming = contentType.includes('text/event-stream');
    const collector = createStreamCollector(kind);
    const pathModelMatch = incomingUrl.pathname.match(/\/models\/([^/:]+):/);
    const pathModel = pathModelMatch ? pathModelMatch[1] : '';

    const responseHeaders = { ...CORS_HEADERS };
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      responseHeaders[key] = value;
    }

    res.writeHead(statusCode, responseHeaders);

    let responseText = '';
    let finished = false;

    const finish = async (usage) => {
      if (finished) return;
      finished = true;
      await finalizeMetering({
        kind,
        provider,
        requestBody: body,
        responseBody: responseText,
        usage,
        statusCode,
        pathModel
      });
    };

    upstreamRes.on('data', (chunk) => {
      res.write(chunk);
      if (!parseable) return;
      if (streaming) {
        collector.push(chunk.toString('utf8'));
      } else {
        responseText = captureText(responseText, chunk);
      }
    });

    upstreamRes.on('aborted', () => {
      res.end();
    });

    upstreamRes.on('end', async () => {
      res.end();
      let usage = null;
      if (statusCode < 400 && parseable) {
        if (streaming) {
          usage = collector.finish();
        } else {
          try {
            usage = extractUsage(kind, JSON.parse(responseText));
          } catch {
            usage = null;
          }
        }
      }
      await finish(usage);
    });

    upstreamRes.on('error', () => {
      res.end();
    });

    req.on('close', () => {
      if (!upstreamRes.complete) upstreamRes.destroy();
    });
  }

  function handleModels(res) {
    const body = {
      object: 'list',
      data: listProviders().flatMap((provider) =>
        provider.models.map((id) => ({ id, object: 'model', owned_by: provider.id }))
      )
    };
    sendJson(res, 200, body);
  }

  async function handle(req, res) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;

    if (pathname === '/health' || pathname === '/') {
      sendJson(res, 200, {
        ok: true,
        app: 'Token Consume',
        version: appVersion,
        provider: getSettings().provider,
        port: listeningPort,
        uptimeSeconds: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
        stats
      });
      return;
    }

    if (pathname === '/v1/models' && req.method === 'GET') {
      handleModels(res);
      return;
    }

    try {
      await handleProxy(req, res);
    } catch (error) {
      stats.failed += 1;
      stats.lastError = error instanceof Error ? error.message : String(error);
      logger.error('[proxy]', stats.lastError);
      sendJson(res, 500, { error: { message: stats.lastError, type: 'token_consume_error' } });
    }
  }

  function start(port) {
    if (server) return Promise.resolve({ port: listeningPort });
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        handle(req, res).catch((error) => {
          sendJson(res, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
        });
      });

      server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });

      server.on('error', (error) => {
        server = null;
        reject(error);
      });

      server.listen(port, '127.0.0.1', () => {
        listeningPort = server.address().port;
        startedAt = Date.now();
        logger.log(`[proxy] listening on http://127.0.0.1:${listeningPort}`);
        resolve({ port: listeningPort });
      });
    });
  }

  function stop() {
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      server.close(() => {
        server = null;
        listeningPort = 0;
        startedAt = null;
        resolve();
      });
    });
  }

  return {
    start,
    stop,
    getStatus() {
      return {
        running: Boolean(server),
        port: listeningPort,
        baseUrl: listeningPort ? `http://127.0.0.1:${listeningPort}/v1` : '',
        stats: { ...stats }
      };
    }
  };
}

module.exports = {
  createMeterProxy,
  joinUpstream,
  requestKind
};
