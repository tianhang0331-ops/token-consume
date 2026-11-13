'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeCostCny, formatCny, resolvePrice } = require('../src/shared/pricing');

test('computes cost from per-million prices', () => {
  assert.equal(
    computeCostCny({
      providerId: 'deepseek',
      model: 'deepseek-chat',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000
    }),
    10
  );
  assert.equal(
    computeCostCny({
      providerId: 'deepseek',
      model: 'deepseek-chat',
      cacheReadTokens: 1_000_000
    }),
    0.5
  );
});

test('unknown models fall back to the provider default price', () => {
  const price = resolvePrice('deepseek', 'some-future-model');
  assert.equal(price.input, 2);
  assert.equal(price.output, 8);
  assert.equal(price.derivedFrom, 'deepseek-chat');
});

test('ignores invalid token counts', () => {
  assert.equal(
    computeCostCny({
      providerId: 'deepseek',
      model: 'deepseek-chat',
      inputTokens: Number.NaN,
      outputTokens: -5
    }),
    0
  );
});

test('formats CNY values', () => {
  assert.equal(formatCny(0), '¥0.00');
  assert.equal(formatCny(12.5), '¥12.50');
});
