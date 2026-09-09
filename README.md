# 民事名誉诉讼文书生成 CLI

> **核心场景: 民事名誉权纠纷 - 被告应诉** (拆解原告起诉状 → 5 个反点逐条反驳)
> 同时支持 4 种律师常用法律文书的本地化生成:律师函 / 民事起诉状 / 民事答辩状 / 证据目录
> 支持 LLM 增强润色 + 纯模板(draft) 模式,中文 CLI,纯本地部署。

## 重要法律声明

**本工具生成的所有文书均不构成律师法律意见,亦不替代执业律师的判断。**

- 工具输出仅作为文书**初稿/参考**使用
- **重大、复杂案件请务必咨询执业律师**
- 使用本工具生成的文书造成的法律后果,由使用者自行承担
- 详见 [docs/法律免责声明.md](docs/法律免责声明.md)

## 5 分钟上手

### 1. 安装 dsh 命令

> 包尚未发布到 npm,`npx defame-shield` 暂不可用;`dsh` 需要先安装依赖并链接。

```bash
cd defame-shield          # 本仓库根目录
pnpm setup                # pnpm ≥8 首次需配置全局 bin 目录 (写入 ~/.zshrc, 之后新开终端生效)
pnpm install
pnpm link --global        # 全局注册 dsh (也可用 npm link)
dsh --help                # 验证
```

> 若 `pnpm link --global` 报 "The configured global bin directory ... is not in PATH",
> 说明 `pnpm setup` 后还没重载 shell 配置 — 新开终端或 `source ~/.zshrc` 后重试。

不做全局链接也可以,在本仓库内直接运行:

```bash
pnpm dev -- <args>                       # 开发模式 (tsx, 无需 build)
pnpm build && node bin/dsh.mjs <args>    # build 后直接跑
```

### 2. 初始化项目

```bash
cd your-project
dsh init
```

### 3. 配置 API key

编辑 `.env.local`:

```bash
MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-你的key
```

> 不填 key 也能用 `--draft` 纯模板模式, 只是没有 LLM 润色。

### 4. 创建案件 (被告视角)

```bash
dsh case new def-sample-001
```

### 5. 拆解原告起诉状

把起诉状复制成 markdown,保存到 `data/cases/sample-001/complaint.md`,然后:

```bash
dsh analyze-complaint data/cases/sample-001/complaint.md --case def-sample-001 --draft
```

输出: `data/cases/def-sample-001/complaint-analysis.json` (拆解结果)

### 6. 生成答辩状 (基于拆解)

```bash
dsh generate defense --case def-sample-001 \
  --from-analysis data/cases/def-sample-001/complaint-analysis.json \
  --draft
```

输出: `data/cases/def-sample-001/outputs/defense-<时间戳>.md`

**答辩状包含**:
- ✅ 总体答辩策略 (按杀伤力排序的 3 个反点)
- ✅ 逐条诉请反驳 (每条匹配最适反点 + 法律依据)
- ✅ 类案参考 (裁判要点式, 不编案号)
- ✅ 答辩证据指引 (基于反点, 提示需补充的证据)
- ✅ 待补充标记 (提示律师补充案件特有事实)

## 4 种文书生成 (基础)

```bash
# 律师函
dsh generate letter --case sample-001

# 民事起诉状 (原告视角)
dsh generate complaint --case sample-001

# 民事答辩状 (被告视角, 走拆解流程效果更好)
dsh generate defense --case sample-001

# 证据目录
dsh generate evidence-list --case sample-001
```

## 5 个核心反点

答辩质量的关键,不在于"否认一切",而在于**逐条打掉原告主张的要件**。

民事名誉权侵权四要件: **违法行为 + 主观过错 + 损害后果 + 因果关系**

| # | 反点 ID | 反点名称 | 法条 | 适用场景 |
|---|---|---|---|---|
| 1 | `fact-true` | 事实基本属实 / 舆论监督免责 | 民法典 1025 | 被告所述有合理来源/已尽核实义务 |
| 2 | `no-act` | 未实施被诉行为 | 民诉法 67 | 账号非被告/内容非被告发 |
| 3 | `no-tort-grade` | 未达名誉权侵害程度 | 民法典 1024 | 未指名/不能识别/属合理评论 |
| 4 | `no-damage` | 无损害后果 | 民法典 1183 | 未举证财产/精神损害 |
| 5 | `no-causation` | 无因果关系 | 民法典 1024 | 损害系他因/无时间关联 |

工具会根据起诉状拆解结果,自动选 1-3 个最适反点,并为每条诉请匹配最适反点。

> 另有 3 个**一票否决**程序性反点 (超过诉讼时效 / 管辖异议 / 被告主体不适格),优先于实体反点,共 8 个反点参与自动选择。

## 命令一览

```
dsh init                                            初始化项目
dsh config show                                     显示配置
dsh config set <key> <value>                        修改配置
dsh case new <id>                                   创建案件
dsh case list                                       列出案件
dsh case show <id>                                  查看案件详情
dsh convert <file>                                  PDF/Word/PPT/Excel → markdown (需 MarkItDown)
dsh analyze-complaint <file> --case <id> [--draft]  拆解起诉状 → JSON
dsh generate <type> --case <id> [--draft]          生成文书
  └─ defense: --from-analysis <json> 必填
dsh self-check <defense> --analysis <json>         抗辩自检, 模拟原告找漏洞 (rule/ai/hybrid)
dsh apply-fixes <defense> --analysis <json>        自检修补建议自动注入答辩状
dsh fill-defense <file>                             交互式填充 [待补充] 占位符
dsh simulate <defense> --analysis <json>            攻防推演, 多轮交锋 + 胜诉概率轨迹
dsh export-pdf <file>                               markdown → PDF (法院文书排版)
```

## 目录结构

```
defame-shield/
├── bin/                  CLI 入口
├── src/
│   ├── cli.ts            commander 命令注册
│   ├── commands/         子命令: init/config/case/analyze/generate
│   ├── analyzer/         起诉状拆解器 (LLM + draft)
│   ├── rebuttal/         8 个反点策略库 (5 实体 + 3 程序) + 自检/攻防推演
│   ├── generators/       文书生成器 (含基于拆解的答辩 v2)
│   ├── converters/       文档转换 (MarkItDown 适配)
│   ├── data/             法条登记 (23 条 + 司法解释, 离线时效检查)
│   ├── case/             案件数据结构 + CRUD
│   ├── config/           dsh.config.json + .env 解析
│   ├── llm/              LLM 客户端 (deepseek/minimax)
│   ├── templates/        4 个 Markdown 模板
│   └── utils/            工具函数 (PDF 导出 / 占位符等)
├── data/
│   └── cases/
│       └── <case-id>/
│           ├── case.json
│           ├── complaint.md          (原告起诉状 markdown, 被告视角时存)
│           ├── complaint-analysis.json (拆解结果)
│           └── outputs/              生成的文书
├── docs/                 法律免责声明 + 答辩工作流 + todo (方向 1/4/5)
├── scripts/              setup.sh (一键装 Node + uv venv + markitdown)
├── __tests__/            111 个单元测试
├── .env.example
├── dsh.config.json       (init 时生成)
└── package.json
```

## LLM Provider

- **deepseek** (默认) — `https://api.deepseek.com/chat/completions`, model: `deepseek-chat`
- **minimax** — `https://api.minimax.chat/v1/text/chatcompletion_v2`, model: `MiniMax-M3`

切换:`MODEL_PROVIDER=minimax` + `MINIMAX_API_KEY=...` 即可。

## 调试

```bash
# 单元测试 (111 个, < 1s)
pnpm test

# 类型检查
pnpm typecheck

# 直接用 tsx 跑
pnpm dev -- generate defense --case def-sample-001 --draft
```

## License

MIT
