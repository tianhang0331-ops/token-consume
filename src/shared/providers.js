'use strict';

/**
 * Provider catalogue for Token Consume.
 *
 * Prices are expressed in CNY per 1,000,000 tokens and are only a convenient
 * default for local estimation. They can drift at any time: always trust the
 * invoice from your provider. Edit this table if your contract differs.
 */

const DEFAULT_PRICE = { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 };

const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DeepSeek',
    usageUrl: 'https://platform.deepseek.com/usage',
    apiBase: 'https://api.deepseek.com/v1',
    protocol: 'openai-chat',
    defaultModel: 'deepseek-chat',
    modelPattern: '^deepseek',
    prices: {
      'deepseek-chat': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
      'deepseek-reasoner': { input: 4, output: 16, cacheRead: 1, cacheWrite: 4 }
    }
  },
  {
    id: 'openai',
    name: 'OpenAI',
    shortName: 'OpenAI',
    usageUrl: 'https://platform.openai.com/account/usage',
    apiBase: 'https://api.openai.com/v1',
    protocol: 'openai-chat',
    defaultModel: 'gpt-4.1',
    modelPattern: '^(gpt|o[0-9]|chatgpt|text-embedding)',
    prices: {
      'gpt-4.1': { input: 14.5, output: 58, cacheRead: 3.6, cacheWrite: 14.5 },
      'gpt-4.1-mini': { input: 2.9, output: 11.6, cacheRead: 0.72, cacheWrite: 2.9 },
      'gpt-4o': { input: 18, output: 72, cacheRead: 9, cacheWrite: 18 },
      'gpt-4o-mini': { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 1.1 },
      'o3-mini': { input: 8, output: 32, cacheRead: 4, cacheWrite: 8 }
    }
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    shortName: 'Claude',
    usageUrl: 'https://platform.claude.com/usage',
    apiBase: 'https://api.anthropic.com/v1',
    protocol: 'anthropic-messages',
    defaultModel: 'claude-sonnet-4-5',
    modelPattern: '^claude',
    prices: {
      'claude-sonnet-4-5': { input: 21.5, output: 107.5, cacheRead: 2.15, cacheWrite: 26.9 },
      'claude-haiku-3-5': { input: 5.8, output: 29, cacheRead: 0.58, cacheWrite: 7.25 },
      'claude-opus-4-1': { input: 108, output: 540, cacheRead: 10.8, cacheWrite: 135 }
    }
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    shortName: 'Gemini',
    usageUrl: 'https://aistudio.google.com/app/usage',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    protocol: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    modelPattern: '^gemini',
    prices: {
      'gemini-2.5-pro': { input: 9, output: 72, cacheRead: 2.2, cacheWrite: 9 },
      'gemini-2.5-flash': { input: 2.2, output: 18, cacheRead: 0.55, cacheWrite: 2.2 }
    }
  },
  {
    id: 'qwen',
    name: '通义千问',
    shortName: 'Qwen',
    usageUrl: 'https://bailian.console.aliyun.com/?tab=model',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    protocol: 'openai-chat',
    defaultModel: 'qwen-plus',
    modelPattern: '^(qwen|qwq)',
    prices: {
      'qwen-plus': { input: 0.8, output: 2, cacheRead: 0.2, cacheWrite: 0.8 },
      'qwen-max': { input: 2.4, output: 9.6, cacheRead: 0.6, cacheWrite: 2.4 },
      'qwen-turbo': { input: 0.3, output: 0.6, cacheRead: 0.08, cacheWrite: 0.3 }
    }
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    shortName: 'Kimi',
    usageUrl: 'https://platform.moonshot.cn/console',
    apiBase: 'https://api.moonshot.cn/v1',
    protocol: 'openai-chat',
    defaultModel: 'moonshot-v1-8k',
    modelPattern: '^(moonshot|kimi)',
    prices: {
      'moonshot-v1-8k': { input: 12, output: 12, cacheRead: 3, cacheWrite: 12 },
      'kimi-k2': { input: 4, output: 16, cacheRead: 1, cacheWrite: 4 }
    }
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    shortName: 'GLM',
    usageUrl: 'https://open.bigmodel.cn/console/overview',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    protocol: 'openai-chat',
    defaultModel: 'glm-4-plus',
    modelPattern: '^glm',
    prices: {
      'glm-4-plus': { input: 50, output: 50, cacheRead: 12.5, cacheWrite: 50 },
      'glm-4-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'glm-4.6': { input: 4, output: 16, cacheRead: 1, cacheWrite: 4 }
    }
  },
  {
    id: 'doubao',
    name: '豆包',
    shortName: 'Doubao',
    usageUrl: 'https://console.volcengine.com/ark',
    apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
    protocol: 'openai-chat',
    defaultModel: 'doubao-seed-1-6',
    modelPattern: '^(doubao|ep-)',
    prices: {
      'doubao-seed-1-6': { input: 0.8, output: 2, cacheRead: 0.2, cacheWrite: 0.8 },
      'doubao-pro-32k': { input: 0.8, output: 2, cacheRead: 0.2, cacheWrite: 0.8 }
    }
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    shortName: 'MiMo',
    usageUrl: 'https://platform.xiaomimimo.com/#/console/usage',
    apiBase: 'https://api.xiaomimimo.com/v1',
    protocol: 'openai-chat',
    defaultModel: 'mimo-v2.5-pro',
    modelPattern: '^mimo',
    prices: {
      'mimo-v2.5-pro': { input: 1, output: 4, cacheRead: 0.25, cacheWrite: 1 }
    }
  }
];

const PROVIDER_MAP = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

function listProviders() {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    shortName: provider.shortName,
    usageUrl: provider.usageUrl,
    apiBase: provider.apiBase,
    protocol: provider.protocol,
    defaultModel: provider.defaultModel,
    models: Object.keys(provider.prices)
  }));
}

function getProvider(providerId) {
  return PROVIDER_MAP.get(providerId) || PROVIDERS[0];
}

function hasProvider(providerId) {
  return PROVIDER_MAP.has(providerId);
}

module.exports = {
  DEFAULT_PRICE,
  PROVIDERS,
  getProvider,
  hasProvider,
  listProviders
};
