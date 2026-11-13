'use strict';

const { DEFAULT_PRICE, getProvider } = require('./providers');

const MILLION = 1_000_000;

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Resolve a per-million-token price for a provider/model pair.
 * Unknown models fall back to the provider default, then to a global default.
 */
function resolvePrice(providerId, model) {
  const provider = getProvider(providerId);
  const table = provider.prices || {};
  const exact = table[model];
  if (exact) return { ...DEFAULT_PRICE, ...exact };

  const defaultPrice = table[provider.defaultModel];
  if (defaultPrice) {
    return {
      ...DEFAULT_PRICE,
      ...defaultPrice,
      // Keep an unknown model distinguishable from the default in the UI.
      derivedFrom: provider.defaultModel
    };
  }
  return { ...DEFAULT_PRICE, derivedFrom: 'fallback' };
}

/**
 * Cost in CNY, rounded to six decimals so that many small requests still add up
 * without floating-point noise.
 */
function computeCostCny({ providerId, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }) {
  const price = resolvePrice(providerId, model);
  const cost =
    (safeNumber(inputTokens) / MILLION) * price.input +
    (safeNumber(outputTokens) / MILLION) * price.output +
    (safeNumber(cacheReadTokens) / MILLION) * price.cacheRead +
    (safeNumber(cacheWriteTokens) / MILLION) * price.cacheWrite;
  return Math.round(cost * 1e6) / 1e6;
}

function formatCny(value, digits = 2) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe < 0 ? '-' : ''}¥${Math.abs(safe).toFixed(digits)}`;
}

module.exports = {
  computeCostCny,
  formatCny,
  resolvePrice,
  safeNumber
};
