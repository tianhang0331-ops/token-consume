'use strict';

/**
 * Heuristic parser for "official usage page" readings.
 *
 * Usage pages are not a stable API: each vendor ships its own dashboard and can
 * redesign it at any time. This parser therefore reads the visible page text and
 * extracts the most plausible numbers. It is intentionally conservative and is
 * labelled "experimental" in the UI.
 */

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ');
}

function toNumber(raw) {
  const cleaned = String(raw || '').replace(/,/g, '').trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1e15) return null;
  return parsed;
}

function collect(pattern, text, group = 1) {
  const values = [];
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match = regex.exec(text);
  while (match) {
    const value = toNumber(match[group]);
    if (value !== null) values.push(value);
    match = regex.exec(text);
    if (values.length > 200) break;
  }
  return values;
}

function findTokens(text) {
  const explicit = [
    ...collect(/([0-9][0-9,.]*)\s*(?:tokens?|词元|令牌)/i, text),
    ...collect(/(?:tokens?|词元|令牌)\s*[:：]?\s*([0-9][0-9,.]*)/i, text)
  ];
  if (explicit.length) return Math.max(...explicit);

  const today = collect(/(?:今日|今天|today)[^\n]{0,24}?([0-9][0-9,]{2,})/i, text);
  if (today.length) return Math.max(...today);

  return null;
}

function findCost(text) {
  const symbol = collect(/[¥￥]\s*([0-9][0-9,]*\.?[0-9]*)/, text);
  const unit = collect(/([0-9][0-9,]*\.?[0-9]*)\s*(?:元|CNY|RMB)/i, text);
  const values = [...symbol, ...unit];
  return values.length ? Math.max(...values) : null;
}

function findModel(text) {
  const match = text.match(/(?:model|模型)\s*[:：]?\s*([A-Za-z][\w.:\-/]{2,40})/i);
  if (!match) return '';
  return match[1].replace(/^models\//, '');
}

function parseUsageText(rawText) {
  const text = normalizeText(rawText);
  const totalTokens = findTokens(text);
  const costCny = findCost(text);
  const model = findModel(text);
  const hasMetrics = totalTokens !== null || costCny !== null;
  const needsLogin =
    !hasMetrics &&
    /(登录|登入|sign in|log in|手机号|验证码|password|api key)/i.test(text) &&
    text.trim().length < 20000;

  return {
    totalTokens: totalTokens === null ? 0 : totalTokens,
    costCny: costCny === null ? 0 : costCny,
    model,
    hasMetrics,
    needsLogin
  };
}

module.exports = { parseUsageText };
