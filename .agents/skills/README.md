# dsh Agent Skills

把 `dsh` 的命令行工作流封装成 [Agent Skills 标准](https://agentskills.io) 的技能, 供 pi / Claude Code 等 agent 加载 — 律师用一句「这份起诉状帮我出答辩状」代替记 6 条命令 + 参数。

**定位**: skill 是「提示词 + 流程约定」, 零代码、随仓库分发; 法律内容 (拆解/反点/法条/免责声明) 全部由 dsh CLI 产出, skill 只编排。

## 技能清单

| skill | 路径 | 覆盖 |
|---|---|---|
| dsh-respond | `dsh-respond/SKILL.md` | 起诉状 → 答辩状端到端 + 事实缺口追问协议 |

## 使用 (pi)

1. 安装 pi: 见 [pi.dev](https://pi.dev) (`npm install -g @earendil-works/pi` 或仓库说明)
2. 在 defame-shield 仓库根目录启动 `pi`, **信任本项目** (项目级 skill 只在受信后加载)
3. 直接说「这是起诉状 pdf, 帮我出答辩状」— agent 按 description 命中 `dsh-respond`; 或强制加载: `/skill:dsh-respond data/cases/xxx/complaint.pdf`
4. 前置条件同 CLI: `pnpm install` (+ `./scripts/setup.sh` 用于 PDF 转换)

pi 的项目级发现路径为 `.pi/skills/` 与 `.agents/skills/` (含 SKILL.md 的目录递归发现); 本仓库放在 `.agents/skills/`, 与 Claude Code / Codex 等其他 harness 的共享目录约定一致。若你的 agent 只认别的目录, 用软链接接过去即可, 不要复制。

## 设计约定 (新增/修改 skill 时遵守)

- **agent 是编排者, dsh 是事实源** — skill 里让模型「运行已存在的 dsh 命令」, 绝不让模型自由生成文书正文
- **事实缺口的唯一通道是 `dsh fill`** — 文书永远从 complaint-analysis.json 重生成; skill 不得引导模型直接编辑 md
- **宁缺毋滥**: 律师没给的值保留 `[待补充]`, skill 中把「不编造」列为硬红线
- skill 里的命令示例必须与 `dsh <cmd> --help` 实测一致, 改动命令接口时同步更新此处
- 保持纯 markdown (frontmatter: name + description), 不引入构建步骤 — 与 Agent Skills 标准互通

## 非目标

- 不做通用法律咨询问答 skill (法律判断只来自 dsh 策略库/法条库)
- 不复制 dsh 法律逻辑进 prompt — CLI 是权威实现, skill 只是说明书
- 原告侧文书 (起诉/函件) 暂不封装
