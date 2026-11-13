'use strict';

/**
 * Provider-agnostic usage extraction.
 *
 * Every function in this module is pure: it never performs I/O and never
 * depends on Electron, which keeps the parsing logic easy to test.
 */

const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g;

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return 0;
}

/** Rough character-based estimate used only when the provider omits usage. */
function estimateTokens(text) {
  const value = String(text || '');
  if (!value.trim()) return 0;
  const cjk = (value.match(CJK_PATTERN) || []).length;
  const rest = Math.max(0, value.length - cjk);
  return Math.max(1, Math.ceil(cjk / 1.5 + rest / 4));
}

function emptyUsage(model = '') {
  return {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimated: false
  };
}

function fromOpenAiChat(body) {
  const usage = body && body.usage;
  if (!usage) return null;
  const prompt = firstNumber(usage.prompt_tokens, usage.input_tokens);
  const cached = firstNumber(
    usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens,
    usage.prompt_cache_hit_tokens,
    usage.cache_hit_tokens
  );
  const miss = numberOrNull(usage.prompt_cache_miss_tokens);
  const input = miss !== null ? miss : Math.max(0, prompt - cached);
  const result = emptyUsage(body.model || '');
  result.inputTokens = input;
  result.outputTokens = firstNumber(usage.completion_tokens, usage.output_tokens);
  result.cacheReadTokens = cached;
  result.cacheWriteTokens = firstNumber(usage.cache_creation_tokens, usage.prompt_cache_write_tokens);
  return result;
}

function fromOpenAiResponses(body) {
  const usage = body && (body.usage || (body.response && body.response.usage));
  if (!usage) return null;
  const cached = firstNumber(usage.input_tokens_details && usage.input_tokens_details.cached_tokens);
  const result = emptyUsage((body && body.model) || (body.response && body.response.model) || '');
  result.inputTokens = Math.max(0, firstNumber(usage.input_tokens) - cached);
  result.outputTokens = firstNumber(usage.output_tokens);
  result.cacheReadTokens = cached;
  result.cacheWriteTokens = firstNumber(usage.input_tokens_details && usage.input_tokens_details.cache_write_tokens);
  return result;
}

function fromAnthropic(body) {
  const usage = body && body.usage;
  if (!usage) return null;
  const result = emptyUsage((body && body.model) || '');
  result.inputTokens = firstNumber(usage.input_tokens);
  result.outputTokens = firstNumber(usage.output_tokens);
  result.cacheReadTokens = firstNumber(usage.cache_read_input_tokens);
  result.cacheWriteTokens = firstNumber(usage.cache_creation_input_tokens);
  return result;
}

function fromGemini(body) {
  const usage = body && (body.usageMetadata || (body.response && body.response.usageMetadata));
  if (!usage) return null;
  const cached = firstNumber(usage.cachedContentTokenCount);
  const result = emptyUsage(((body && (body.modelVersion || body.model)) || '').replace(/^models\//, ''));
  result.inputTokens = Math.max(0, firstNumber(usage.promptTokenCount) - cached);
  result.outputTokens = firstNumber(usage.candidatesTokenCount) + firstNumber(usage.thoughtsTokenCount);
  result.cacheReadTokens = cached;
  return result;
}

function extractUsage(kind, body) {
  if (!body || typeof body !== 'object') return null;
  switch (kind) {
    case 'openai-chat':
      return fromOpenAiChat(body);
    case 'openai-responses':
      return fromOpenAiResponses(body);
    case 'anthropic-messages':
      return fromAnthropic(body);
    case 'gemini':
      return fromGemini(body);
    default:
      return null;
  }
}

function createStreamCollector(kind) {
  let buffer = '';
  let model = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let sawUsage = false;
  let text = '';

  function applyPayload(payload) {
    if (!payload || typeof payload !== 'object') return;

    if (kind === 'anthropic-messages') {
      if (payload.type === 'message_start' && payload.message) {
        model = payload.message.model || model;
        const usage = payload.message.usage || {};
        inputTokens = firstNumber(usage.input_tokens);
        cacheReadTokens = firstNumber(usage.cache_read_input_tokens);
        cacheWriteTokens = firstNumber(usage.cache_creation_input_tokens);
        outputTokens = firstNumber(usage.output_tokens);
        sawUsage = true;
      } else if (payload.type === 'message_delta' && payload.usage) {
        if (payload.usage.output_tokens !== undefined) {
          outputTokens = firstNumber(payload.usage.output_tokens);
          sawUsage = true;
        }
      } else if (payload.type === 'content_block_delta' && payload.delta && typeof payload.delta.text === 'string') {
        text += payload.delta.text;
      }
      return;
    }

    if (kind === 'openai-responses') {
      if (payload.type === 'response.completed' || payload.type === 'response.incomplete') {
        const response = payload.response || {};
        model = response.model || model;
        const usage = response.usage;
        if (usage) {
          const cached = firstNumber(usage.input_tokens_details && usage.input_tokens_details.cached_tokens);
          inputTokens = Math.max(0, firstNumber(usage.input_tokens) - cached);
          outputTokens = firstNumber(usage.output_tokens);
          cacheReadTokens = cached;
          sawUsage = true;
        }
      } else if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
        text += payload.delta;
      }
      return;
    }

    if (kind === 'gemini') {
      if (payload.modelVersion) model = String(payload.modelVersion).replace(/^models\//, '');
      if (payload.usageMetadata) {
        const usage = payload.usageMetadata;
        const cached = firstNumber(usage.cachedContentTokenCount);
        inputTokens = Math.max(0, firstNumber(usage.promptTokenCount) - cached);
        outputTokens = firstNumber(usage.candidatesTokenCount) + firstNumber(usage.thoughtsTokenCount);
        cacheReadTokens = cached;
        sawUsage = true;
      }
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      for (const candidate of candidates) {
        const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
          ? candidate.content.parts
          : [];
        for (const part of parts) {
          if (part && typeof part.text === 'string') text += part.text;
        }
      }
      return;
    }

    // openai-chat (also covers OpenAI-compatible vendors).
    if (payload.model) model = payload.model;
    if (payload.usage) {
      const cached = firstNumber(
        payload.usage.prompt_tokens_details && payload.usage.prompt_tokens_details.cached_tokens,
        payload.usage.prompt_cache_hit_tokens
      );
      const miss = numberOrNull(payload.usage.prompt_cache_miss_tokens);
      const prompt = firstNumber(payload.usage.prompt_tokens);
      inputTokens = miss !== null ? miss : Math.max(0, prompt - cached);
      outputTokens = firstNumber(payload.usage.completion_tokens, payload.usage.output_tokens);
      cacheReadTokens = cached;
      sawUsage = true;
    }
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
      if (choice && choice.delta && typeof choice.delta.content === 'string') {
        text += choice.delta.content;
      } else if (choice && typeof choice.text === 'string') {
        text += choice.text;
      }
    }
  }

  return {
    push(chunk) {
      buffer += String(chunk || '');
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data && data !== '[DONE]') {
            try {
              applyPayload(JSON.parse(data));
            } catch {
              // Ignore partial or non-JSON SSE frames.
            }
          }
        }
        index = buffer.indexOf('\n');
      }
    },
    finish() {
      if (sawUsage) {
        return {
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          estimated: false
        };
      }
      return {
        model,
        inputTokens: 0,
        outputTokens: estimateTokens(text),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimated: true
      };
    },
    responseText() {
      return text;
    }
  };
}

module.exports = {
  createStreamCollector,
  estimateTokens,
  extractUsage
};
