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
  .description('创建案件 (交互式填写当事人/事实)')
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

program.parseAsync(process.argv).catch((err) => {
  out.error((err as Error)?.message || String(err));
  process.exit(1);
});
