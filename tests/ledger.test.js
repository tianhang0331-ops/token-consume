'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Ledger, summarize } = require('../src/shared/ledger');

const NOW = new Date(2026, 10, 13, 12, 0, 0);

function event(overrides = {}) {
  return {
    providerId: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    source: 'proxy',
    ...overrides
  };
}

test('summarizes today, month, week and models', () => {
  const events = [
    { ...event({ id: 'a' }), ts: new Date(2026, 10, 13, 9, 0, 0).toISOString() },
    { ...event({ id: 'b', model: 'deepseek-reasoner' }), ts: new Date(2026, 10, 13, 10, 0, 0).toISOString() },
    { ...event({ id: 'c' }), ts: new Date(2026, 10, 12, 10, 0, 0).toISOString() },
    { ...event({ id: 'd' }), ts: new Date(2026, 9, 20, 10, 0, 0).toISOString() }
  ];

  const snapshot = summarize(events, NOW);

  assert.equal(snapshot.today.requests, 2);
  assert.equal(snapshot.today.inputTokens, 200);
  assert.equal(snapshot.today.outputTokens, 100);
  assert.equal(snapshot.today.totalTokens, 300);
  assert.equal(snapshot.today.dateKey, '2026-11-13');

  assert.equal(snapshot.month.requests, 3);
  assert.equal(snapshot.month.monthKey, '2026-11');

  assert.equal(snapshot.last7Days.length, 7);
  assert.equal(snapshot.last7Days[6].dateKey, '2026-11-13');
  assert.equal(snapshot.last7Days[6].totalTokens, 300);

  assert.equal(snapshot.today.models.length, 2);
  assert.equal(snapshot.today.models[0].model, 'deepseek-reasoner');
});

test('counts estimated events separately', () => {
  const snapshot = summarize(
    [
      { ...event({ id: 'e', estimated: true }), ts: new Date(2026, 10, 13, 8, 0, 0).toISOString() },
      { ...event({ id: 'f' }), ts: new Date(2026, 10, 13, 8, 30, 0).toISOString() }
    ],
    NOW
  );

  assert.equal(snapshot.today.estimatedCount, 1);
});

test('ledger persists, reloads and resets', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'token-consume-'));
  const filePath = path.join(directory, 'ledger.json');

  const ledger = new Ledger({ filePath });
  await ledger.add(event({ id: 'one', inputTokens: 1000, outputTokens: 1000 }));

  const reloaded = new Ledger({ filePath });
  await reloaded.load();
  assert.equal(reloaded.snapshot(NOW).totals.events, 1);

  await reloaded.reset('today');
  assert.equal(reloaded.snapshot(NOW).totals.events, 0);

  const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(stored.version, 1);
  assert.equal(stored.events.length, 0);

  await fs.rm(directory, { recursive: true, force: true });
});

test('normalizes tokens and computes cost', async () => {
  const ledger = new Ledger({ filePath: path.join(os.tmpdir(), `token-consume-${Date.now()}.json`) });
  const stored = await ledger.add(event());
  assert.equal(stored.totalTokens, 150);
  assert.equal(stored.costCny, 0.0006);
});
