# dsh — 民事名誉权诉讼文书生成 CLI

> **核心场景: 民事名誉权纠纷 - 被告应诉** (拆解原告起诉状 → 5 实体 + 3 程序反点逐条反驳 → 生成答辩状)
> 兼顾律师 4 种常用文书的本地化生成: 律师函 / 民事起诉状 / 民事答辩状 / 证据目录。
> LLM 增强 + 纯模板 (`--draft`) 双模式, 中文 CLI, 纯本地部署, 无数据库。

## 重要法律声明

**本工具生成的所有文书均不构成律师法律意见,亦不替代执业律师的判断。**

- 工具输出仅作为文书**初稿/参考**使用
- **重大、复杂案件请务必咨询执业律师**
- 使用本工具生成的文书造成的法律后果,由使用者自行承担
- 详见 [docs/法律免责声明.md](docs/法律免责声明.md)

## 先看数据流: 每份文件是谁的

dsh 在案件目录 `data/cases/<id>/` 里流转 3 类文件。**搞清归属,所有命令的参数就好记了**:

| 文件 | 谁的 | 产生方式 | 被谁消费 |
|---|---|---|---|
| `complaint.md` | **原告** (起诉状) | 律师誊抄, 或 `dsh convert` 从 PDF/Word 转换 | `analyze-complaint` |
| `complaint-analysis.json` | 中性 — 原告主张的**结构化拆解** (主体/诉请/事实/证据 + 四要件评分) | `dsh analyze-complaint`; 事实缺口用 `dsh fill` 回填 (留 `_fillLog` 审计) | `generate defense --from-analysis`、`self-check --analysis`、`simulate --analysis`、`apply-fixes --analysis` |
| `outputs/defense-*.md` | **被告** (答辩状) | `dsh generate defense` | 提交法院前的润色链: `self-check <defense>` → `apply-fixes <defense>` → `simulate <defense>` → `export-pdf` |

两个高频参数一句话:

- **`<defense>`** (self-check / apply-fixes / simulate 的位置参数) = 答辩状文件路径,即上表第三行。**只有被告有答辩状** — 这三步都是"拿着被告的稿子做文章"。
- **`--analysis`** = 拆解结果 JSON 路径,即上表第二行。自检/推演需要它,才知道原告主张了什么、被告漏没漏。

```
起诉状.pdf ──convert──▶ complaint.md ──analyze-complaint──▶ complaint-analysis.json
                                                              │ (自动回填 case.json 原告/诉请/事实/法院)
                                          generate defense ───┴─▶ defense-*.md   ◀── 被告的稿子
                                                                    │
                                fill (事实缺口回填 JSON→重生成) / self-check (挑漏洞) ─▶ apply-fixes / fill-defense
                                                                    │
                                            simulate (原被告多轮交锋, 胜诉概率轨迹) ─▶ export-pdf ─▶ 提交法院
```

## 5 分钟上手

### 1. 安装 dsh 命令

> 包尚未发布到 npm,`npx defame-shield` 暂不可用;`dsh` 需要先安装依赖并链接。

```bash
cd defame-shield          # 本仓库根目录
pnpm setup                # pnpm 首次需配置全局 bin 目录 (写入 ~/.zshrc, 之后新开终端生效)
pnpm install
pnpm add -g .             # 全局注册 dsh (pnpm 11; pnpm ≤10 用 pnpm link --global, 也可用 npm link)
dsh --help                # 验证
```

> 若 `pnpm link --global` 报 "The configured global bin directory ... is not in PATH",
> 说明 `pnpm setup` 后还没重载 shell 配置 — 新开终端或 `source ~/.zshrc` 后重试。

不做全局链接也可以,在本仓库内直接运行:

```bash
pnpm dev -- <args>                       # 开发模式 (tsx, 无需 build)
pnpm build && node bin/dsh.mjs <args>    # build 后直接跑
```

需要 PDF/Word 转换 (`convert` / `analyze-complaint *.pdf`) 的话,再装一次 Python 侧组件:

```bash
./scripts/setup.sh         # 一键: pnpm deps + uv venv + Microsoft MarkItDown
dsh convert --check        # 验证 markitdown 可用
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

> 不填 key 也能用 `--draft` 纯模板模式, 只是没有 LLM 润色; 所有命令离线可用。

---

### 场景 A: 你是被告 (收到起诉状, 要交答辩状)

完整 7 步,每步产物是下一步的输入:

```bash
# ① 建案 — 只问被告侧信息 (当事人必填; 地址/律师等选填)。
#    原告/诉请/事实/法院不用手填, ② 拆解起诉状后自动回填。
dsh case new def-001

# ② 拆解起诉状 (站原告视角, 把主张拆成结构化 JSON + 四要件评分)
#    .pdf/.docx 自动先转 markdown; --draft = 纯正则, 不调 LLM
dsh analyze-complaint 起诉状.pdf --case def-001 --draft
#    → data/cases/def-001/complaint-analysis.json

# ③ 生成答辩状 (站被告视角, 8 反点自动选型: 每条诉请匹配最适反点)
dsh generate defense --case def-001 \
  --from-analysis data/cases/def-001/complaint-analysis.json \
  --draft
#    → data/cases/def-001/outputs/defense-<时间戳>.md   ← 后面命令里的 <defense> 就是它

# ④ 自检: 换位到原告律师, 攻击你刚写的答辩状, 列出漏洞清单
dsh self-check data/cases/def-001/outputs/defense-<时间戳>.md \
  --analysis data/cases/def-001/complaint-analysis.json

# ⑤ 回填事实 + 修补:
#    事实缺口补进拆解 JSON (唯一事实源, 重生成不丢, 留 _fillLog 审计):
dsh fill data/cases/def-001/complaint-analysis.json --set "facts.time=2026-03-12" --allow-new
#    然后重跑 ③, 再注入修补 (程序性反点仅在拆解能确证时才注入, 宁缺毋滥;
#    目标 patched 已存在时会拒绝覆盖, 确认后加 --yes; 人工改稿用 fill-defense 交互式填充)
dsh apply-fixes data/cases/def-001/outputs/defense-<时间戳>.md \
  --analysis data/cases/def-001/complaint-analysis.json
#    → defense-<时间戳>-patched.md

# ⑥ 攻防推演: 模拟原被告多轮交锋, 输出被告胜诉概率轨迹与下一步建议
dsh simulate data/cases/def-001/outputs/defense-<时间戳>-patched.md \
  --analysis data/cases/def-001/complaint-analysis.json --case def-001

# ⑦ 导出法院排版 PDF
dsh export-pdf data/cases/def-001/outputs/defense-<时间戳>-patched.md
```

**答辩状包含**:
- ✅ 总体答辩策略 (按杀伤力排序的 top-3 反点)
- ✅ 逐条诉请反驳 (每条匹配最适反点 + 法律依据)
- ✅ 类案参考 (裁判要点式, 不编案号)
- ✅ 答辩证据指引 (基于反点, 提示需补充的证据)
- ✅ 待补充标记 (`[待补充: ...]`, 提示律师补案件特有事实 — 工具绝不虚构)

端到端细节见 [docs/答辩工作流.md](docs/答辩工作流.md);现成样本 `data/cases/def-sample-001/` 可对照。

### 场景 B: 你是原告 (起诉方的基础文书)

起诉状、律师函、证据目录走模板生成,不经过拆解链路:

```bash
dsh generate letter         --case <id> --draft   # 律师函 (发函警告, 诉前第一步)
dsh generate complaint      --case <id> --draft   # 民事起诉状
dsh generate evidence-list  --case <id> --draft   # 证据目录
```

> 注意: `case new` 是按**被告应诉**场景设计的 (只问被告侧, 原告留占位符)。
> 作为原告使用时,请手动编辑 `data/cases/<id>/case.json` 补齐原被告双方与事实/证据字段,
> 或直接把生成的 `.md` 当模板底稿改。
> 若被告也用了 dsh,你的起诉状会被对方 `analyze-complaint` 逐条拆解 — 诉请写法请更严谨。

## 8 个核心反点

答辩质量的关键,不在于"否认一切",而在于**逐条打掉原告主张的要件**。

民事名誉权侵权四要件: **违法行为 + 主观过错 + 损害后果 + 因果关系**

| # | 反点 ID | 反点名称 | 法条 | 适用场景 |
|---|---|---|---|---|
| 1 | `fact-true` | 事实基本属实 / 舆论监督免责 | 民法典 1025 | 被告所述有合理来源/已尽核实义务 |
| 2 | `no-act` | 未实施被诉行为 | 民诉法 67 | 账号非被告/内容非被告发 |
| 3 | `no-tort-grade` | 未达名誉权侵害程度 | 民法典 1024 | 未指名/不能识别/属合理评论 |
| 4 | `no-damage` | 无损害后果 | 民法典 1183 | 未举证财产/精神损害 |
| 5 | `no-causation` | 无因果关系 | 民法典 1024 | 损害系他因/无时间关联 |

另有 3 个**一票否决**程序性反点,优先于实体反点参与选型:

| # | 反点 ID | 反点名称 | 法条 | 触发条件 (从严, 宁缺毋滥) |
|---|---|---|---|---|
| 6 | `statute-limitations` | 超过诉讼时效 | 民法典 188 (995 除外) | 拆解能确认侵权→起诉间隔 > 3 年; 仅攻击损害赔偿类诉请 |
| 7 | `jurisdiction` | 管辖异议 | 民诉法 24/130 | 有侵权行为地行政区划线索且与被告住所地不同域 |
| 8 | `wrong-party` | 被告主体不适格 | 民法典 1191 等 | 发布平台/雇主线索 |

工具根据拆解结果自动选 top-3 总体反点,并为每条诉请匹配最适反点。
**拿不准的程序性反点不会写进文书** — 自检/修补只在拆解数据足以确证时才注入相关断言。

## 命令一览

```
dsh init                                            初始化项目 (dsh.config.json + .env.local)
dsh config show / set <key> <value>                 查看/修改配置 (author/llmEnabled/casesDir/outputsDir)
dsh case new <id>                                   建案 (只填被告侧; 原告侧见场景 B 注意事项)
dsh case list / show <id>                           案件列表/详情
dsh convert <file> [--out|--print-meta|--check]     PDF/Word/PPT/Excel → markdown (需 MarkItDown)
dsh analyze-complaint <起诉状> [选项]               拆解 → complaint-analysis.json
  --case <id>          输出到案件目录并自动回填 case.json (推荐)
  --draft              纯关键词/正则抽取, 不调 LLM
  --extra <text>       给 LLM 的补充指令      --out <path>  自定义输出路径
dsh generate <type> --case <id> [选项]              生成文书 (letter/complaint/defense/evidence-list)
  --from-analysis <json>   [仅 defense] 基于拆解结果的反点驱动版 (推荐)
  --draft / --provider / --output / --extra
dsh self-check <defense> --analysis <json> [选项]   站原告视角挑漏洞 (rule/ai/hybrid)
  --severe-only          仅显示 critical/high       --out <json>  落盘漏洞清单
dsh apply-fixes <defense> --analysis <json> [选项]  修补建议自动注入 → *-patched.md
  --critical-only        仅注入 critical            --vulnerabilities <json>  复用已有清单
  --yes                  目标 patched 已存在时确认覆盖 (默认拒绝并给分流指引)
dsh fill <analysis.json> [选项]                     非交互回填拆解 JSON 字段 (补事实的唯一通道)
  --set "路径=值" (可重复)  --from <json>  --allow-new  --out <path>
dsh fill-defense <file> [--out]                     交互式填充 [待补充] 占位符 (文书层, 人工润色)
dsh simulate <defense> --analysis <json> [选项]     攻防推演 → 胜诉概率轨迹 (rule/ai)
  --case <id>  --rounds <n>  --mode <rule|ai>  --out <json>
dsh export-pdf <file> [--out|--case-number|--title] markdown → PDF (法院文书排版)
```

> `<defense>` = 答辩状 md 路径 (generate defense 的产物);`--analysis` = 拆解 JSON 路径。二者见上文数据流表。

## Agent 模式 (不想记命令)

仓库自带 [Agent Skills](https://agentskills.io) 标准技能 `.agents/skills/dsh-respond/SKILL.md`: 在仓库根启动 [pi](https://pi.dev) (或接入 Claude Code 等兼容 harness) 并信任项目后, 直接说「这是起诉状 PDF, 帮我出答辩状」即可 — agent 按技能跑完上面 7 步, 并逐个追问事实缺口 (`dsh fill` 回填)。dsh 仍是法律内容的唯一事实源, agent 只编排交互。启用与约定见 [.agents/skills/README.md](.agents/skills/README.md)。

## 开发

```bash
pnpm test                # 170 个单元测试, <1s, 不发任何网络请求 (只测 draft/rule 模式)
pnpm test __tests__/simulator.test.ts
pnpm typecheck && pnpm lint && pnpm build
```

双模式是硬性约定: 任何 LLM 功能必须保留 `--draft`/rule 纯模板路径。

## 目录结构

```
defame-shield/
├── bin/                  CLI 入口
├── src/
│   ├── cli.ts            commander 命令注册
│   ├── commands/         子命令薄层 (init/config/case/analyze/generate/…)
│   ├── analyzer/         起诉状拆解器 (AI + draft 双实现)
│   ├── rebuttal/         8 反点策略库 (5 实体 + 3 程序) + 命中检测/自检/攻防推演
│   ├── generators/       文书生成器 (含反点驱动答辩 v2) + 模板渲染
│   ├── converters/       文档转换 (MarkItDown 适配)
│   ├── data/             法条登记 (23 条 + 司法解释, 离线时效检查)
│   ├── case/             案件数据结构 + CRUD
│   ├── config/           dsh.config.json + .env 解析
│   ├── llm/              LLM 客户端 (deepseek/minimax, 瞬时故障自动重试)
│   ├── templates/        4 个 Markdown 模板
│   └── utils/            工具函数 (PDF 导出/占位符/JSON 等)
├── data/cases/<case-id>/ case.json + complaint.md + complaint-analysis.json + outputs/
├── docs/                 法律免责声明 + 答辩工作流 + todo
├── scripts/              setup.sh (一键装依赖 + uv venv + markitdown)
├── __tests__/            160 个单元测试
└── package.json
```

## LLM Provider

- **deepseek** (默认) — model `deepseek-flash`
- **minimax** — model `MiniMax-M3`

切换: `MODEL_PROVIDER=minimax` + `MINIMAX_API_KEY=...`。LLM 失败自动回退 draft,不会丢工作。

## License

MIT
