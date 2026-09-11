# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

defame-shield (`dsh`):中文民事名誉权诉讼文书生成 CLI。**核心场景是被告应诉** — 拆解原告起诉状,用 5 个实体反点 + 3 个程序性反点逐条反驳,生成答辩状。纯本地文件存储(`data/cases/`),无数据库。

技术栈:TypeScript ESM (Node ≥ 18.17, pnpm) + Python 侧组件 Microsoft MarkItDown(uv venv,用于 PDF/Word → Markdown 转换)。

## 常用命令

```bash
./scripts/setup.sh                        # 一键安装: pnpm deps + uv venv + markitdown
pnpm dev -- <args>                        # 开发模式跑 CLI (tsx 直接执行 src/cli.ts, 无需 build)
pnpm test                                 # vitest (~170 个用例, <1s, 不发任何网络请求)
pnpm test __tests__/simulator.test.ts     # 单测文件
pnpm test -t "用例名关键字"                # 单个用例
pnpm typecheck                            # tsc --noEmit
pnpm lint                                 # eslint src/ bin/
pnpm build                                # tsc → dist/ (tsconfig.build.json)
pnpm dev -- convert --check               # 验证 markitdown 是否可用
```

smoke 测试可用现成样本:`data/cases/def-sample-001/`(被告视角,含 complaint-analysis.json)。

## 架构 — 文书流水线

每个环节是 `dsh` 子命令,产物在 `data/cases/<id>/` 下流转:

```
complaint.pdf/docx ─(convert: markitdown)→ complaint.md
  ─(analyze-complaint)→ complaint-analysis.json
  ─(generate defense --from-analysis)→ outputs/defense-*.md
  ─(self-check → apply-fixes)→ defense-patched.md   # apply-fixes 目标已存在需 --yes 才覆盖
  ─(simulate: 攻防推演) / (export-pdf)

事实缺口: dsh fill <analysis.json> --set/--from 回填 (唯一事实源, 留 _fillLog; 改完重跑 generate)

模块分工:

- `src/analyzer/complaint-parser.ts` — 起诉状拆解为 `ComplaintAnalysis` JSON(主体/诉请/事实/证据 4 维 + 四要件评分 `ElementScore`)。**AI 和 draft 双实现**(draft = 关键词/正则抽取)
- `src/rebuttal/` — 反点策略库。`strategies-base.ts` 定义类型,`strategies.ts` 5 个实体反点,`procedural.ts` 3 个"一票否决"程序性反点(时效/管辖/主体不适格,优先于实体反点)。每个反点有 `applicability(analysis)` 0–1 评分函数;`selectStrategies` 选 top-3,`selectStrategyForClaim` 为每条诉请匹配最适反点。`simulator.ts`(攻防推演)、`self-check.ts`(找漏洞)
- `src/generators/` — `defense.ts` v2 反点驱动的答辩状生成;`render.ts` 做 `{{ 字段 }}` 模板替换,模板在 `src/templates/*.md`(变量键是中文,如 `{{ 原告.name }}`)
- `src/commands/` — CLI 薄层:解析参数 → 调核心模块 → 写文件 + 输出(`utils/console.ts`)。命令注册在 `src/cli.ts`
- `src/llm/client.ts` — 唯一 LLM 入口 `callLLM()`,provider deepseek/minimax(OpenAI 兼容协议)。**返回 `LLMResult {ok, code}` 而非 throw**,上层自行决定错误呈现
- `src/data/statutes.ts` — 内置 23 条法条 + 司法解释登记(含 `lastReviewed`),离线做法条时效检查,**不联网**
- `src/config/` — `dsh.config.json`(项目级)+ `.env.local`/`.env`(自写极简解析器,不依赖 dotenv;`loadEnvFile()` 在 cli.ts 启动时调用)。API key:`DEEPSEEK_API_KEY` / `MINIMAX_API_KEY`,由 `MODEL_PROVIDER` 切换

## 领域不变量(修改模板/策略/生成器时必须保持)

这是法律工具,以下产品规则优先于代码便利:

1. **绝不编造案号** — 类案参考只用"裁判要点式"(`title`/`holding`/`applicableWhen`),不虚构案号
2. **不虚构事实** — 案件特有事实一律留 `[待补充: ...]` 占位符由律师填写;self-check 把残留占位符判为 CRITICAL 漏洞
3. **双模式强制** — 任何 LLM 功能必须保留 `--draft`/`rule` 纯模板路径,无网络、无 API key 可用;测试只走 draft/rule 模式
4. **输出必附免责声明** — 所有生成文书末尾保留"不构成律师法律意见"提示

## 约定

- ESM:源码内相互 import 带 `.js` 扩展名;`@/*` 别名指向 `src/*`(tsconfig paths + vitest.config.ts 已配)
- TS `strict` + `noUncheckedIndexedAccess`:数组/Map 索引结果为 `undefined`,必须处理
- 用户可见输出、代码注释、commit message 均为中文;commit 风格 `feat(defame-shield): ...`
- 案件数据是 plain JSON/Markdown 文件,不要引入数据库或外部服务
- `data/cases/*/outputs/*.md` 被 gitignore(生成物不入库)

## 文档

- `README.md` — 5 分钟上手 + 命令一览 + 5 反点表
- `.agents/skills/` — Agent Skills 标准技能 (pi 等 agent 的对话式入口; dsh 仍是法律内容唯一事实源)
- `docs/答辩工作流.md` — 端到端工作流程(拿到起诉状 → 提交法院)
- `docs/法律免责声明.md` — 使用边界
- `docs/todo.md` — backlog(方向 1 证据存证 / 方向 4 法律检索 / 方向 5)
