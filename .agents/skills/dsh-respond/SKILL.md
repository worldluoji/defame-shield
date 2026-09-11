---
name: dsh-respond
description: 收到名誉权纠纷起诉状后, 以被告律师视角端到端生成民事答辩状。convert → 拆解起诉状 → 逐个追问事实缺口 → fill 回填 → 生成反点驱动答辩状 → 自检 → 修补。用户提到起诉状/应诉/答辩/被打官司时使用。
license: Apache-2.0
compatibility: 需在 defame-shield 仓库根目录运行 (pnpm 安装依赖; PDF/Word 输入需 ./scripts/setup.sh 的 markitdown venv)
---

# dsh-respond — 起诉状 → 答辩状 (被告视角)

你是**流程编排者**: 通过对话收集事实、驱动 `dsh` 命令。所有法律内容 (拆解/反点/法条/免责声明) 由 dsh 代码产出 — **你自己永远不写答辩状正文**。文书永远从 `complaint-analysis.json` 重新生成, 不在 md 上打补丁。

所有命令在仓库根目录执行, 前缀 `pnpm dev --` (下文省略)。

## 硬红线 (任何情况不得违反)

1. **不编造数字** — 占位符 (如 `[账号 ID]`, `[阅读量]`) 没有律师给的值就原样保留, 并向用户明示还剩几处。绝不生成示例值。
2. **不虚构案号/类案/法条** — 类案参考由 dsh 内置库给出, 你不引用任何外部判例。
3. **不改已有文书句子** — 补事实只通过 `dsh fill` 写回 JSON → 重跑 generate; 绝不用编辑工具直接改 defense 正文。
4. **交付前必过 self-check** — self-check 报出「占位符未填」CRITICAL 漏洞时, 回到追问循环, 不得绕过。
5. **免责声明必须保留** — 文书末尾「不构成律师法律意见」段落是 dsh 加的, 不得删除。
6. **AI 生成模式默认关闭** — generate/self-check 一律 `--draft` / `--mode rule`, 你的 LLM 负责对话, dsh 负责模板。

## 主流程 (7 步)

### 1. 前置检查

```bash
dsh convert --check          # 输入是 PDF/Word 时必须 ✓; 失败则跑 ./scripts/setup.sh
ls data/cases/               # 参考样本: def-sample-001/ (含 complaint-analysis.json 成品)
```

用户只给了文字版起诉状 → 存成 `complaint.md` 跳过 convert。

### 2. 建案 + 拆解

```bash
dsh case new <id>                                    # 只填被告侧 (姓名/法院/日期)
dsh convert <起诉状.pdf> --out data/cases/<id>/complaint.md
dsh analyze-complaint data/cases/<id>/complaint.md --case <id> --draft
```

→ `data/cases/<id>/complaint-analysis.json` (主体/诉请/事实/证据 + 四要件评分)

### 3. 先出一版初稿 (让用户看到全貌)

```bash
dsh generate defense --case <id> --from-analysis data/cases/<id>/complaint-analysis.json --draft --output defense.md
```

→ `data/cases/<id>/outputs/defense.md`, 其中 `[待补充: ...]` 就是接下来要问的。

### 4. 追问协议 (核心环节)

1. **Read** `complaint-analysis.json`, 列出所有空串/null/缺失字段 (重点: `parties.被告.name/idNumber/address`、`facts.time/place/spread`、`filingDate`、`courtOfFiling`)
2. **逐条问, 一次一个字段**, 每条带「用在哪、为什么需要」, 例:
   > 「发帖时间」用于诉讼时效反点 (民诉法解释: 知道权利受损起 3 年), 起诉状只写了"今年3月" — 具体日期?
3. 律师答不上 → 保留 `[待补充]`, 记入最终交付清单。**不要追问第二轮**。
4. 用户说「就这些」→ 停止追问, 进入回填。

### 5. 回填 + 重生成

答案写成 JSON 数组 (note 会进审计日志):

```bash
cat > /tmp/answers.json <<'EOF'
[
  { "path": "parties.被告.name",  "value": "李四",        "note": "律师口述" },
  { "path": "facts.time",         "value": "2026-03-12",  "note": "律师口述" },
  { "path": "facts.spread",       "value": "阅读量约 2 万", "note": "后台截图" },
  { "path": "filingDate",         "value": "2026-08-01",  "note": "法院受理通知书" }
]
EOF
dsh fill data/cases/<id>/complaint-analysis.json --from /tmp/answers.json --allow-new
dsh generate defense --case <id> --from-analysis data/cases/<id>/complaint-analysis.json --draft --output defense.md
```

`fill` 规则: 默认只写**已存在**字段 (防你笔误造字段); `--allow-new` 放行末端新增 (如 filingDate); 任一路径非法 → 整批不写入; 每次回填在 JSON 里追加 `_fillLog` 审计记录 (path/previous/value/filledAt)。

### 6. 自检 → 修补闭环

```bash
dsh self-check data/cases/<id>/outputs/defense.md --analysis data/cases/<id>/complaint-analysis.json \
  --out data/cases/<id>/outputs/defense-vulnerabilities.json   # 不加 --out 则只打印报告

dsh apply-fixes data/cases/<id>/outputs/defense.md \
  --analysis data/cases/<id>/complaint-analysis.json \
  --out data/cases/<id>/outputs/defense-patched.md
```

- 仍有事实类漏洞 → 回第 4 步再问一轮。
- 结构性漏洞 → `apply-fixes` 注入提醒段落, 以 `defense-patched.md` 为交付版。
- **若命令被拦截 (exit 2, 「目标 patched 文件已存在」)**: 不要自动加 `--yes` — 把指引里的 (a) 重打基线版 / (b) 续补已有 patched 两种选择转述给用户, 确认后再执行。

### 7. 交付清单

向用户报告:
1. 终稿路径 (`outputs/defense-patched.md` 或 `defense.md`)
2. 残留 `[待补充]` 占位符数量及位置 — 提示人工补完后再 `dsh fill-defense` 或回第 5 步
3. 下一步: `dsh simulate` 攻防推演评估胜算 / `dsh export-pdf` 出法院排版 (或提示用户另行发起)

## 命令速查

| 命令 | 用途 |
|---|---|
| `dsh convert <file> [--out] [--check]` | PDF/Word → markdown |
| `dsh case new <id>` / `case list` / `case show <id>` | 案件管理 (被告侧信息) |
| `dsh analyze-complaint <起诉状> --case <id> --draft` | 拆解 → complaint-analysis.json |
| `dsh generate defense --case <id> --from-analysis <json> [--draft] --output <name>.md` | 答辩状 → outputs/<name>.md |
| `dsh self-check <defense> --analysis <json> [--mode rule] [--out <json>]` | 抗攻击自检 (--out 才落盘漏洞清单) |
| `dsh apply-fixes <defense> --analysis <json> [--out <file>] [--yes]` | 注入修补 → *-patched.md (目标已存在需 --yes) |
| `dsh fill <analysis.json> [--set "路径=值"] / [--from patches.json] [--allow-new] [--out]` | JSON 层回填 (留 _fillLog) |
| `dsh fill-defense <file> [--out]` | 文书层交互式填充 (**人工**润色用, 你不用交互命令) |

## 排错

- `找不到构建产物 dist/` → `pnpm build`
- convert 失败 / `markitdown: command not found` → `./scripts/setup.sh` 或 `uv pip install markitdown`
- `fill` 报「字段不存在」→ 核对 JSON 键名与大小写 (如 `parties.被告.name`), 或按需加 `--allow-new`
- 拆解质量差 (draft 模式正则局限) → 提示用户可配 API key 后用 `dsh analyze-complaint` 不带 `--draft`
- 全流程样本对照: `data/cases/def-sample-001/` (defendant 视角, 含成品 complaint-analysis.json)

## 非目标

- **只服务被告应诉** — 不做原告侧起诉文书 (generate complaint 走普通 CLI, 不套本技能)
- 不解答一般法律咨询; 法律判断只来自 dsh 的反点策略库与法条库
