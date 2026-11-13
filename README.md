# Token Consume

> 本地优先的 AI Token 用量与花费计量桌面应用。  
> A local-first desktop meter for AI token usage and spend.

Token Consume 是一个开源、无账号、无云同步的 Electron 桌面应用。它把 AI API 请求经本地透明代理转发，从响应中读取真实 `usage`，写入本地账本，并以悬浮小组件的形式实时展示今日消耗、花费、预算进度与模型分布。

数据始终留在你自己的电脑上。

---

## 功能特性

- **透明代理计量**：内置 `http://127.0.0.1:17862/v1`，兼容 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 与 Google Gemini，支持流式（SSE）与非流式响应。
- **真实 Usage 优先**：优先读取上游返回的 `usage` 字段（含缓存命中的 token），缺失时按字符数估算并标记为「估算记录」。
- **本地账本**：按请求记录 provider、model、输入/输出/缓存 token 与费用，自动汇总今日、本月、近 7 天、24 小时与模型分布。
- **预算进度**：设置今日预算，进度条实时反馈，超支变色。
- **多厂商目录**：DeepSeek、OpenAI、Anthropic、Google Gemini、通义千问、Kimi、智谱 GLM、豆包、Xiaomi MiMo。
- **官方用量页读数（实验性）**：在应用内打开厂商官方用量页并登录，使用独立持久会话读取页面数字，仅作对照展示，不写入本地账本。
- **桌面小组件体验**：无边框、半透明、置顶悬浮窗，支持托盘常驻、最小化与快捷隐藏。
- **零密钥存储**：应用不保存任何 API Key，只转发调用方自带的鉴权头；不发起任何遥测请求。

## 界面

- 主视图：今日 Tokens、今日花费、预算进度、请求数、输入/输出、估算记录、近 7 天柱状图、模型分布、官方页读数。
- 设置视图：厂商、代理端口、预算、置顶、官方页同步、数据目录、重置账本。

## 快速开始

环境要求：Node.js 18+（推荐 20+）。

```bash
git clone https://github.com/tianhang0331-ops/token-consume.git
cd token-consume
npm install
npm start
```

打包安装包（可选）：

```bash
npm run dist        # 当前平台
npm run dist:win    # Windows NSIS + portable
```

### 运行检查

```bash
npm run check       # 对全部 JS 做语法检查
npm test            # Node 内置测试运行器，24 个用例
```

## 使用方式

### 1. 把请求指向本地代理

保持 Token Consume 运行，把任意 OpenAI 兼容 SDK 的 `base_url` 改为：

```text
http://127.0.0.1:17862/v1
```

示例（Node.js + OpenAI SDK）：

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "http://127.0.0.1:17862/v1"
});

const result = await client.chat.completions.create({
  model: "deepseek-chat",
  messages: [{ role: "user", content: "你好" }]
});
```

使用 `curl`：

```bash
curl http://127.0.0.1:17862/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'
```

### 2. 选择厂商

在设置中选择当前使用的厂商。代理会按该厂商的上游地址转发；鉴权头由调用方自行提供。

如需跨厂商同时使用，可在请求头中覆盖：

```text
x-token-consume-provider: openai
```

### 3. 支持的接口

| 协议 | 路径 | 计量来源 |
| --- | --- | --- |
| OpenAI Chat Completions | `POST /v1/chat/completions` | `usage.prompt_tokens` / `completion_tokens` / 缓存字段 |
| OpenAI Responses | `POST /v1/responses` | `usage.input_tokens` / `output_tokens` |
| Anthropic Messages | `POST /v1/messages` | `usage.input_tokens` / `output_tokens` / cache 字段 |
| Gemini | `POST /v1beta/models/{model}:generateContent` | `usageMetadata` |
| 其他 | 任意路径 | 原样转发，不计量 |

流式请求会边转发边解析 SSE 帧；若上游未返回 usage，则按响应文本估算。

### 4. 健康检查

```bash
curl http://127.0.0.1:17862/health
```

## 计费说明

- 费用按 **CNY / 百万 tokens** 的价目表估算，默认表位于 [`src/shared/providers.js`](src/shared/providers.js)。
- 价目表只是便于本地估算的默认值，可能与你的实际合同价、折扣或最新官方定价不同。请以厂商账单为准。
- 未知模型会回退到该厂商的默认模型价格。
- 缓存命中 token 按单独的缓存单价计算；各厂商的 token 口径已在解析层归一化。

## 数据与隐私

- 账本、设置与官方页读数保存在 Electron 的 `userData` 目录：
  - Windows：`%APPDATA%\/Token Consume\`
  - macOS：`~/Library/Application Support/Token Consume/`
  - Linux：`~/.config/Token Consume/`
- 可通过设置中的「打开数据目录」直接查看。
- 应用不上传账本、不收集遥测、不保存 API Key。
- 官方用量页使用独立的持久会话（`persist:token-consume-<provider>`），登录发生在厂商页面内，凭据不经过应用代码。
- 代理只监听 `127.0.0.1`，不会暴露到局域网。

## 项目结构

```text
token-consume/
├─ assets/
│  ├─ icon.svg                 # 品牌图标源文件
│  └─ icon.png                 # 安装时由 npm run icon 生成
├─ scripts/
│  ├─ check.js                 # 语法检查
│  └─ make-icon.js             # 零依赖 PNG 生成
├─ src/
│  ├─ main/
│  │  ├─ main.js               # Electron 主进程、IPC、托盘、窗口
│  │  ├─ proxy-server.js       # 本地计量代理
│  │  └─ platform-sync.js      # 官方用量页读取（实验性）
│  ├─ preload/preload.js       # 安全 IPC 桥
│  ├─ renderer/                # 无框架界面（HTML / CSS / JS）
│  └─ shared/
│     ├─ providers.js          # 厂商目录与价目表
│     ├─ pricing.js            # 费用计算
│     ├─ ledger.js             # 账本、持久化、汇总
│     ├─ usage-parser.js       # 各协议 usage 解析
│     └─ page-metrics.js       # 用量页面文本解析
└─ tests/                      # node:test 单元与集成测试
```

## 设计取舍

- **纯 Node 逻辑与 Electron 解耦**：账本、定价、解析、代理均可脱离 Electron 单测，CI 无需下载 Electron。
- **无框架渲染层**：界面只有 HTML/CSS/原生 JS，减少依赖与攻击面。
- **上下文隔离 + 沙箱**：渲染进程不开启 Node 集成，仅通过 `contextBridge` 暴露白名单 IPC。
- **代理仅做转发与计量**：不缓存请求体、不落盘请求内容，只在结束后写入 token 统计。

## 路线图

- [ ] 可编辑的价目表与自定义模型
- [ ] 账本导入/导出（CSV / JSON）
- [ ] 周报与月报视图
- [ ] 请求级明细列表
- [ ] 更多协议（Azure OpenAI、Bedrock）
- [ ] 自动更新

## 贡献

欢迎 Issue 与 Pull Request。提交前请确保：

```bash
npm run check && npm test
```

## License

[MIT](LICENSE) © 2026 Token Consume Contributors
