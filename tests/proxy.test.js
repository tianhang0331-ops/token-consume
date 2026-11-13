'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createMeterProxy, joinUpstream, requestKind } = require('../src/main/proxy-server');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function send({ port, path, headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(body);
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': payload.length, ...headers }
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: response.headers })
        );
      }
    );
    request.on('error', reject);
    request.end(payload);
  });
}

function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for usage event')), ms))
  ]);
}

test('proxy helpers resolve paths and request kinds', () => {
  assert.equal(requestKind('/v1/chat/completions'), 'openai-chat');
  assert.equal(requestKind('/v1/messages'), 'anthropic-messages');
  assert.equal(requestKind('/v1beta/models/gemini-2.5-pro:streamGenerateContent'), 'gemini');

  const target = joinUpstream('https://api.deepseek.com/v1', '/v1/chat/completions', '');
  assert.equal(target.path, '/v1/chat/completions');
  assert.equal(target.hostname, 'api.deepseek.com');
});

test('meters a non-streaming OpenAI compatible response', async (t) => {
  let received = null;
  const upstream = await listen((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received = { url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { role: 'assistant', content: 'hello' } }],
          usage: { prompt_tokens: 300, completion_tokens: 80, prompt_cache_hit_tokens: 200 }
        })
      );
    });
  });

  let resolveUsage;
  const usageEvent = new Promise((resolve) => {
    resolveUsage = resolve;
  });

  const proxy = createMeterProxy({
    getSettings: () => ({ provider: 'deepseek' }),
    onUsage: (event) => {
      resolveUsage(event);
    },
    allowBaseUrlOverride: true,
    logger: { log() {}, error() {} }
  });

  await proxy.start(0);
  t.after(async () => {
    await proxy.stop();
    await close(upstream.server);
  });

  const response = await send({
    port: proxy.getStatus().port,
    path: '/v1/chat/completions',
    headers: {
      authorization: 'Bearer test-key',
      'x-token-consume-base-url': `http://127.0.0.1:${upstream.port}`
    },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] })
  });

  assert.equal(response.status, 200);
  const event = await withTimeout(usageEvent);

  assert.equal(received.url, '/v1/chat/completions');
  assert.equal(received.headers.authorization, 'Bearer test-key');
  assert.equal(event.providerId, 'deepseek');
  assert.equal(event.model, 'deepseek-chat');
  assert.equal(event.inputTokens, 100);
  assert.equal(event.outputTokens, 80);
  assert.equal(event.cacheReadTokens, 200);
  assert.equal(event.estimated, false);
});

test('meters a streaming response and forwards the stream', async (t) => {
  const frames = [
    'data: {"model":"deepseek-chat","choices":[{"delta":{"content":"he"}}]}\n\n',
    'data: {"model":"deepseek-chat","choices":[{"delta":{"content":"llo"}}]}\n\n',
    'data: {"model":"deepseek-chat","choices":[],"usage":{"prompt_tokens":30,"completion_tokens":12,"total_tokens":42}}\n\n',
    'data: [DONE]\n\n'
  ];

  const upstream = await listen((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(frames[0]);
      setTimeout(() => {
        res.write(frames[1]);
        res.write(frames[2]);
        res.end(frames[3]);
      }, 20);
    });
  });

  let resolveUsage;
  const usageEvent = new Promise((resolve) => {
    resolveUsage = resolve;
  });

  const proxy = createMeterProxy({
    getSettings: () => ({ provider: 'deepseek' }),
    onUsage: (event) => resolveUsage(event),
    allowBaseUrlOverride: true,
    logger: { log() {}, error() {} }
  });

  await proxy.start(0);
  t.after(async () => {
    await proxy.stop();
    await close(upstream.server);
  });

  const response = await send({
    port: proxy.getStatus().port,
    path: '/v1/chat/completions',
    headers: { 'x-token-consume-base-url': `http://127.0.0.1:${upstream.port}` },
    body: JSON.stringify({ model: 'deepseek-chat', stream: true, messages: [] })
  });

  assert.match(response.body, /\[DONE\]/);
  assert.equal(response.headers['access-control-allow-origin'], '*');

  const event = await withTimeout(usageEvent);
  assert.equal(event.inputTokens, 30);
  assert.equal(event.outputTokens, 12);
  assert.equal(event.estimated, false);
});

test('falls back to estimates when the upstream omits usage', async (t) => {
  const upstream = await listen((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'deepseek-chat', choices: [{ message: { content: 'hello there' } }] }));
    });
  });

  let resolveUsage;
  const usageEvent = new Promise((resolve) => {
    resolveUsage = resolve;
  });

  const proxy = createMeterProxy({
    getSettings: () => ({ provider: 'deepseek' }),
    onUsage: (event) => resolveUsage(event),
    allowBaseUrlOverride: true,
    logger: { log() {}, error() {} }
  });

  await proxy.start(0);
  t.after(async () => {
    await proxy.stop();
    await close(upstream.server);
  });

  await send({
    port: proxy.getStatus().port,
    path: '/v1/chat/completions',
    headers: { 'x-token-consume-base-url': `http://127.0.0.1:${upstream.port}` },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi there' }] })
  });

  const event = await withTimeout(usageEvent);
  assert.equal(event.estimated, true);
  assert.ok(event.inputTokens > 0);
  assert.ok(event.outputTokens > 0);
});

test('serves a local health endpoint without an upstream call', async (t) => {
  const proxy = createMeterProxy({
    getSettings: () => ({ provider: 'deepseek' }),
    onUsage: () => {},
    appVersion: '1.0.0',
    logger: { log() {}, error() {} }
  });
  await proxy.start(0);
  t.after(() => proxy.stop());

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${proxy.getStatus().port}/health`, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });

  const payload = JSON.parse(body);
  assert.equal(payload.ok, true);
  assert.equal(payload.version, '1.0.0');
  assert.equal(payload.provider, 'deepseek');
});
