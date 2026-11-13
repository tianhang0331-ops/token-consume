'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUsageText } = require('../src/shared/page-metrics');

test('reads a usage dashboard text', () => {
  const metrics = parseUsageText(`
    今日用量
    消耗 Tokens 12,345
    今日花费 ¥1.23
    模型：deepseek-chat
  `);

  assert.equal(metrics.totalTokens, 12345);
  assert.equal(metrics.costCny, 1.23);
  assert.equal(metrics.model, 'deepseek-chat');
  assert.equal(metrics.hasMetrics, true);
  assert.equal(metrics.needsLogin, false);
});

test('detects a login wall', () => {
  const metrics = parseUsageText('请登录后查看用量 手机号 验证码');
  assert.equal(metrics.hasMetrics, false);
  assert.equal(metrics.needsLogin, true);
});

test('returns empty metrics for an unrelated page', () => {
  const metrics = parseUsageText('欢迎使用控制台');
  assert.equal(metrics.hasMetrics, false);
  assert.equal(metrics.needsLogin, false);
});
