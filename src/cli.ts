/**
 * dsh — defame-shield CLI 入口
 *
 * 中文:
 *   dsh init                                  初始化项目
 *   dsh config show                           显示配置
 *   dsh config set <key> <value>              修改配置
 *   dsh case new <id>                         创建案件
 *   dsh case list                             列出案件
 *   dsh case show <id>                        查看案件详情
 *   dsh generate <type> --case <id>           生成文书
 *     type: letter / complaint / defense / evidence-list
 *     --draft           纯模板, 不调 LLM
 *     --provider        deepseek | minimax
 *     --output          自定义输出文件名
 *     --extra           给 LLM 的额外指令
 */
import { Command } from 'commander';
import { loadEnvFile } from './config/env.js';
import { initCommand } from './commands/init.js';
import { configShowCommand, configSetCommand } from './commands/config.js';
import { caseNewCommand, caseListCommand, caseShowCommand, caseSetCommand } from './commands/case.js';
import { generateCommand } from './commands/generate.js';
import { analyzeComplaintCommand } from './commands/analyze.js';
import { selfCheckCommand } from './commands/self-check.js';
import { fillDefenseCommand } from './commands/fill-defense.js';
import { fillAnalysisCommand } from './commands/fill-analysis.js';
import { exportPdfCommand } from './commands/export-pdf.js';
import { applyFixesCommand } from './commands/apply-fixes.js';
import { simulateCommand } from './commands/simulate.js';
import { convertCommand } from './commands/convert.js';
import { out } from './utils/console.js';

loadEnvFile();

const program = new Command();
program
  .name('dsh')
  .description('民事名誉诉讼文书生成 CLI (律师函/起诉状/答辩状/证据目录)')
  .version('0.1.0');

program
  .command('init')
  .description('初始化项目 (创建 dsh.config.json + .env.local + 案件目录)')
  .action(initCommand);

const config = program.command('config').description('查看/修改配置');
config.command('show').description('显示当前配置').action(configShowCommand);
config
  .command('set <key> <value>')
  .description('设置配置项 (author / llmEnabled / casesDir / outputsDir)')
  .action((key: string, value: string) => configSetCommand(key, value));

const caseCmd = program.command('case').description('案件管理');
caseCmd
  .command('new <id>')
  .description('创建案件 (只填被告侧信息; 原告/诉请/事实由 analyze-complaint --case 拆解起诉状自动回填)')
  .action(caseNewCommand);
caseCmd.command('list').description('列出所有案件 (含流水线阶段状态)').action(caseListCommand);
caseCmd
  .command('show <id>')
  .description('显示案件详情: 流水线状态 + 期限倒计时 + 残留占位符 + 推荐下一步 (--json 输出原始 case.json)')
  .option('--json', '输出 case.json 原文 (供脚本/agent 使用)', false)
  .action((id: string, flags: { json?: boolean }) => caseShowCommand(id, flags));
caseCmd
  .command('set <id> <key> <value>')
  .description('后补被告侧字段: servedAt (答辩期倒计时) / defendantFacts (被告方陈述) / evidence (证据清单 JSON, 整组替换); 原告/诉请/事实由拆解回填, 不走此命令')
  .action((id: string, key: string, value: string) => caseSetCommand(id, key, value));

const analyzeCmd = program.command('analyze-complaint <file>').description('拆解原告起诉状 → JSON');
analyzeCmd
  .option('--draft', '纯模板 (关键词抽取), 不调 LLM', false)
  .option('--provider <provider>', 'LLM provider (deepseek/minimax)')
  .option('--case <id>', '关联到本地案件 (输出到 data/cases/<id>/complaint-analysis.json)')
  .option('--keep-identity', '身份保护 (需已建案): 手填的姓名/证件/电话不被拆解结果覆盖或回填; 落盘 JSON 中证件号/电话脱敏 — 保护落盘数据与后续 AI 调用 (AI 拆解这一跳的起诉状原文仍会上云, 绝对不上云请配 --draft)', false)
  .option('--out <path>', '自定义输出路径')
  .option('--silent', '静默模式, 不输出 JSON 内容', false)
  .option('--extra <text>', '给 LLM 的额外指令')
  .action(analyzeComplaintCommand);

const fillCmd = program.command('fill-defense <file>').description('交互式填充答辩状中的 [待补充] 占位符');
fillCmd
  .option('--yes', '跳过确认, 直接开始', false)
  .option('--out <path>', '输出路径 (默认: <原名>-filled.md)')
  .action(fillDefenseCommand);

const fillJsonCmd = program.command('fill [analysis]').description('非交互回填拆解 JSON 字段 (点路径=值, 留 _fillLog 审计; 供 agent/批量使用)');
fillJsonCmd
  .option('--case <id>', '案件 ID (自动定位 data/cases/<id>/complaint-analysis.json)')
  .option('--set <path=value>', '回填一项, 可重复 (如 --set "facts.time=2026-03-12")', (v: string, acc: string[]) => [...acc, v], [])
  .option('--from <json>', '批量回填文件: {路径: 值} 或 [{path, value, note?}]')
  .option('--allow-new', '允许新增 JSON 中尚不存在的末端字段 (父级路径须已存在; 如 draft 未产出的 filingDate)', false)
  .option('--out <path>', '输出路径 (默认: 原地写回)')
  .action(fillAnalysisCommand);

const applyCmd = program.command('apply-fixes [defense]').description('自检修补建议自动注入答辩状 (--case 自动定位当前稿与拆解 JSON)');
applyCmd
  .option('--analysis <json>', '拆解结果 JSON 路径 (省略时从 --case 定位)')
  .option('--case <id>', '案件 ID (自动定位 outputs 当前稿 + complaint-analysis.json)')
  .option('--out <path>', '输出路径 (默认: <原名>-patched.md; 目标已存在时需 --yes 确认覆盖)')
  .option('--yes', '目标 patched 文件已存在时确认覆盖', false)
  .option('--critical-only', '仅注入 critical 风险', false)
  .option('--vulnerabilities <json>', '使用已有漏洞列表, 跳过 self-check')
  .action(applyFixesCommand);

const convertCmd = program.command('convert [file]').description('文档转换: PDF/Word/PPT/Excel → markdown (pdf/docx 无 markitdown 时自动走纯 Node 兜底)');
convertCmd
  .option('--out <path>', '输出 markdown 路径 (默认: <原名>.md)')
  .option('--no-cache', '跳过缓存, 强制重新转换')
  .option('--native', '强制纯 Node 转换 (mammoth/pdf.js, 不调 markitdown; 仅 pdf/docx)', false)
  .option('--print-meta', '打印完整元数据', false)
  .option('--check', '检查转换能力 (纯 Node 兜底 + markitdown)', false)
  .action(convertCommand);

const simCmd = program.command('simulate [defense]').description('攻防推演 — 模拟原/被告多轮交锋, 评估风险走向 (--case 自动定位当前稿与拆解 JSON)');
simCmd
  .option('--analysis <json>', '拆解结果 JSON 路径 (省略时从 --case 定位)')
  .option('--case <id>', '本地案件 ID (自动定位当前稿 + 拆解 JSON, 提供更准确的被告信息)')
  .option('--rounds <n>', '推演轮数 (默认 3)', (v: string, _previous: number) => parseInt(v, 10), 3)
  .option('--mode <mode>', '模式: rule | ai (默认 rule)', 'rule')
  .option('--provider <provider>', 'LLM provider')
  .option('--out <path>', '输出 JSON 路径')
  .action(simulateCommand);

const exportCmd = program.command('export-pdf <file>').description('Markdown → PDF 转换 (中国法院文书排版)');
exportCmd
  .option('--out <path>', '输出 PDF 路径 (默认: <同名>.pdf)')
  .option('--case-number <number>', '案号 (页脚显示)')
  .option('--title <title>', 'PDF 文档标题')
  .action(exportPdfCommand);

const selfCheckCmd = program.command('self-check [defense]').description('抗辩自检 — 模拟原告律师找漏洞 (--case 自动定位当前稿与拆解 JSON)');
selfCheckCmd
  .option('--analysis <json>', '拆解结果 JSON 路径 (省略时从 --case 定位)')
  .option('--case <id>', '案件 ID (自动定位 outputs 当前稿 + complaint-analysis.json)')
  .option('--mode <mode>', '模式: rule | ai | hybrid (默认 rule)', 'rule')
  .option('--provider <provider>', 'LLM provider (deepseek/minimax)')
  .option('--out <path>', '输出 JSON 路径')
  .option('--severe-only', '仅显示 critical/high 漏洞', false)
  .action(selfCheckCommand);

const genCmd = program.command('generate <type>').description('生成文书');
genCmd
  .requiredOption('--case <id>', '案件 ID')
  .option('--draft', '纯模板模式, 不调 LLM', false)
  .option('--provider <provider>', 'LLM provider (deepseek/minimax)')
  .option('--output <filename>', '自定义输出文件名')
  .option('--extra <text>', '给 LLM 的额外指令')
  .option('--from-analysis <path>', '[仅 defense] 从拆解结果 JSON 生成答辩状 (省略时 --case 自动使用案件内拆解结果)')
  .action(generateCommand);

// pnpm run 会把 `--` 原样透传给脚本, commander 遇 `--` 停止解析选项 (--draft 等失效), 剥掉首个
const argv = process.argv[2] === '--'
  ? [...process.argv.slice(0, 2), ...process.argv.slice(3)]
  : process.argv;

program.parseAsync(argv).catch((err) => {
  out.error((err as Error)?.message || String(err));
  process.exit(1);
});
