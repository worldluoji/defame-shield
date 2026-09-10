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
import { caseNewCommand, caseListCommand, caseShowCommand } from './commands/case.js';
import { generateCommand } from './commands/generate.js';
import { analyzeComplaintCommand } from './commands/analyze.js';
import { selfCheckCommand } from './commands/self-check.js';
import { fillDefenseCommand } from './commands/fill-defense.js';
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
caseCmd.command('list').description('列出所有案件').action(caseListCommand);
caseCmd
  .command('show <id>')
  .description('显示案件详情 (case.json)')
  .action((id: string) => caseShowCommand(id));

const analyzeCmd = program.command('analyze-complaint <file>').description('拆解原告起诉状 → JSON');
analyzeCmd
  .option('--draft', '纯模板 (关键词抽取), 不调 LLM', false)
  .option('--provider <provider>', 'LLM provider (deepseek/minimax)')
  .option('--case <id>', '关联到本地案件 (输出到 data/cases/<id>/complaint-analysis.json)')
  .option('--out <path>', '自定义输出路径')
  .option('--silent', '静默模式, 不输出 JSON 内容', false)
  .option('--extra <text>', '给 LLM 的额外指令')
  .action(analyzeComplaintCommand);

const fillCmd = program.command('fill-defense <file>').description('交互式填充答辩状中的 [待补充] 占位符');
fillCmd
  .option('--yes', '跳过确认, 直接开始', false)
  .option('--out <path>', '输出路径 (默认: <原名>-filled.md)')
  .action(fillDefenseCommand);

const applyCmd = program.command('apply-fixes <defense>').description('自检修补建议自动注入答辩状');
applyCmd
  .requiredOption('--analysis <json>', '拆解结果 JSON 路径')
  .option('--out <path>', '输出路径 (默认: <原名>-patched.md)')
  .option('--critical-only', '仅注入 critical 风险', false)
  .option('--vulnerabilities <json>', '使用已有漏洞列表, 跳过 self-check')
  .action(applyFixesCommand);

const convertCmd = program.command('convert <file>').description('文档转换: PDF/Word/PPT/Excel → markdown (需安装 Microsoft MarkItDown)');
convertCmd
  .option('--out <path>', '输出 markdown 路径 (默认: <原名>.md)')
  .option('--no-cache', '跳过缓存, 强制重新转换')
  .option('--print-meta', '打印完整元数据', false)
  .option('--check', '仅检查 markitdown 是否已安装', false)
  .action(convertCommand);

const simCmd = program.command('simulate <defense>').description('攻防推演 — 模拟原/被告多轮交锋, 评估胜诉概率轨迹');
simCmd
  .requiredOption('--analysis <json>', '拆解结果 JSON 路径')
  .option('--case <id>', '本地案件 ID (提供更准确的被告信息)')
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

const selfCheckCmd = program.command('self-check <defense>').description('抗辩自检 — 模拟原告律师找漏洞');
selfCheckCmd
  .requiredOption('--analysis <json>', '拆解结果 JSON 路径')
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
  .option('--from-analysis <path>', '[仅 defense] 从拆解结果 JSON 生成答辩状')
  .action(generateCommand);

// pnpm run 会把 `--` 原样透传给脚本, commander 遇 `--` 停止解析选项 (--draft 等失效), 剥掉首个
const argv = process.argv[2] === '--'
  ? [...process.argv.slice(0, 2), ...process.argv.slice(3)]
  : process.argv;

program.parseAsync(argv).catch((err) => {
  out.error((err as Error)?.message || String(err));
  process.exit(1);
});
