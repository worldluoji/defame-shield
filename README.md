# 民事名誉诉讼文书生成 CLI

> 4 种律师常用法律文书的本地化生成工具:律师函 / 民事起诉状 / 民事答辩状 / 证据目录
> 支持 LLM 增强润色 + 纯模板(draft) 模式,中文 CLI,纯本地部署。

## 重要法律声明

**本工具生成的所有文书均不构成律师法律意见,亦不替代执业律师的判断。**

- 工具输出仅作为文书**初稿/参考**使用
- **重大、复杂案件请务必咨询执业律师**
- 使用本工具生成的文书造成的法律后果,由使用者自行承担
- 详见 [docs/法律免责声明.md](docs/法律免责声明.md)

## 5 分钟上手

### 1. 初始化项目

```bash
cd your-project
npx defame-shield init   # 或 pnpm dsh init
```

`init` 会:
- 创建 `dsh.config.json` (项目配置)
- 从 `.env.example` 复制到 `.env.local` (你需要填 API key)
- 创建 `data/cases/` 案件目录

### 2. 配置 API key

编辑 `.env.local`:

```bash
MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-你的key
```

> 不填 key 也能用 `--draft` 纯模板模式, 只是没有 LLM 润色。

### 3. 创建案件

```bash
dsh case new sample-001
```

交互式填写:
- 案件标题
- 案由 (网络/传统媒体/其他)
- 原告/被告信息
- 律师信息(选填)
- 事实摘要 (侵权时间/方式/内容/后果)
- 管辖法院(选填)

### 4. 生成文书

```bash
# 律师函
dsh generate letter --case sample-001

# 民事起诉状
dsh generate complaint --case sample-001

# 民事答辩状
dsh generate defense --case sample-001

# 证据目录
dsh generate evidence-list --case sample-001
```

输出到 `data/cases/sample-001/outputs/<文书>-<时间戳>.md`

### 5. 常用选项

```bash
# 纯模板, 不调 LLM, 快/可预测/可审计
dsh generate letter --case sample-001 --draft

# 指定 provider
dsh generate letter --case sample-001 --provider deepseek

# 自定义输出文件名
dsh generate letter --case sample-001 --output my-letter.md

# 给 LLM 额外指令
dsh generate complaint --case sample-001 --extra "请重点突出第 3、4 条诉讼请求"
```

## 4 种文书模板

| 类型 | 命令 | 适用场景 | 关键法条 |
|---|---|---|---|
| 律师函 | `letter` | 诉前警告, 督促履行 | 民法典 1024、1025 |
| 民事起诉状 | `complaint` | 向法院提起名誉权之诉 | 民法典 1024、1183 |
| 民事答辩状 | `defense` | 作为被告应诉答辩 | 民法典 1025 (核心: 舆论监督免责) |
| 证据目录 | `evidence-list` | 整理提交证据 | 民诉法 66、证据若干规定 |

## 目录结构

```
defame-shield/
├── bin/                  CLI 入口
├── src/
│   ├── cli.ts            命令注册 (commander)
│   ├── commands/         子命令实现
│   ├── case/             案件数据结构 + CRUD
│   ├── config/           配置 + env 解析
│   ├── generators/       文书生成器
│   ├── llm/              LLM 客户端 (deepseek/minimax)
│   ├── templates/        Markdown 模板
│   ├── types.ts          公共类型
│   └── utils/            工具函数
├── data/
│   └── cases/            案件数据 (按 ID 一个目录)
│       └── <case-id>/
│           ├── case.json
│           └── outputs/  生成的文书
├── docs/                 文档
├── __tests__/            单元测试
├── .env.example
├── dsh.config.json       (init 时生成)
└── package.json
```

## 命令一览

```
dsh init                                            初始化项目
dsh config show                                     显示配置
dsh config set <key> <value>                        修改配置
dsh case new <id>                                   创建案件
dsh case list                                       列出案件
dsh case show <id>                                  查看案件详情
dsh generate <type> --case <id> [--draft]           生成文书
```

## LLM Provider

- **deepseek** (默认) — `https://api.deepseek.com/chat/completions`, model: `deepseek-chat`
- **minimax** — `https://api.minimax.chat/v1/text/chatcompletion_v2`, model: `MiniMax-M3`

切换:`MODEL_PROVIDER=minimax` + `MINIMAX_API_KEY=...` 即可。

## 调试

```bash
# 单元测试
pnpm test

# 类型检查
pnpm typecheck

# 直接用 tsx 跑 (开发时)
pnpm dev -- generate letter --case sample-001 --draft
```

## License

MIT
