'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStreamCollector, estimateTokens, extractUsage } = require('../src/shared/usage-parser');

test('extracts OpenAI chat usage and separates cached tokens', () => {
  const usage = extractUsage('openai-chat', {
    model: 'deepseek-chat',
    usage: { prompt_tokens: 300, completion_tokens: 80, prompt_cache_hit_tokens: 200 }
  });

  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 80);
  assert.equal(usage.cacheReadTokens, 200);
  assert.equal(usage.model, 'deepseek-chat');
});

test('extracts Anthropic cache usage', () => {
  const usage = extractUsage('anthropic-messages', {
    model: 'claude-sonnet-4-5',
    usage: {
      input_tokens: 50,
      output_tokens: 20,
      cache_read_input_tokens: 400,
      cache_creation_input_tokens: 10
    }
  });

  assert.deepEqual(
    {
      input: usage.inputTokens,
      output: usage.outputTokens,
      read: usage.cacheReadTokens,
      write: usage.cacheWriteTokens
    },
    { input: 50, output: 20, read: 400, write: 10 }
  );
});

test('extracts Gemini usage metadata', () => {
  const usage = extractUsage('gemini', {
    modelVersion: 'models/gemini-2.5-pro',
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 5, cachedContentTokenCount: 20 }
  });

  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 35);
  assert.equal(usage.cacheReadTokens, 20);
  assert.equal(usage.model, 'gemini-2.5-pro');
});

test('returns null when the payload has no usage', () => {
  assert.equal(extractUsage('openai-chat', { choices: [] }), null);
});

test('parses SSE usage split across chunk boundaries', () => {
  const collector = createStreamCollector('openai-chat');
  collector.push('data: {"model":"deepseek-chat","choices":[{"delta":{"content":"he');
  collector.push('llo"}}]}\n\ndata: {"model":"deepseek-chat","choices":[],"usage":{"prompt_tokens":30,');
  collector.push('"completion_tokens":12,"total_tokens":42}}\n\ndata: [DONE]\n\n');

  const usage = collector.finish();
  assert.equal(usage.estimated, false);
  assert.equal(usage.model, 'deepseek-chat');
  assert.equal(usage.inputTokens, 30);
  assert.equal(usage.outputTokens, 12);
});

test('parses Anthropic message_start and message_delta', () => {
  const collector = createStreamCollector('anthropic-messages');
  collector.push(
    'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":40,"cache_read_input_tokens":10,"output_tokens":1}}}\n\n'
  );
  collector.push('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":99}}\n\n');

  const usage = collector.finish();
  assert.equal(usage.estimated, false);
  assert.equal(usage.inputTokens, 40);
  assert.equal(usage.outputTokens, 99);
  assert.equal(usage.cacheReadTokens, 10);
});

test('falls back to an estimate when no usage frame exists', () => {
  const collector = createStreamCollector('openai-chat');
  collector.push('data: {"choices":[{"delta":{"content":"hello world, this is a meter test"}}]}\n\n');

  const usage = collector.finish();
  assert.equal(usage.estimated, true);
  assert.ok(usage.outputTokens > 0);
});

test('estimates CJK and latin text differently', () => {
  assert.ok(estimateTokens('你好世界') >= 2);
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('hello world') >= 2);
});
