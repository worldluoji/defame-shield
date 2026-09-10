/**
 * dsh case new — 交互式创建案件
 * dsh case list — 列出所有案件
 * dsh case show <id> — 显示案件详情
 */
import inquirer from 'inquirer';
import { loadConfig } from '../config/config.js';
import { caseDir, createCase, listCases, loadCase } from '../case/case.js';
import { out, die } from '../utils/console.js';
import type { CaseInput } from '../case/types.js';

export async function caseNewCommand(id: string): Promise<void> {
  const config = loadConfig();

  // 只问"被告侧"信息 — 原告/诉请/事实/法院由 dsh analyze-complaint 拆解起诉状自动回填
  const a = await inquirer.prompt<{
    title: string;
    cause: CaseInput['cause'];
    defendantName: string;
    defendantId: string;
    defendantAddress: string;
    defendantContact: string;
    lawyerName: string;
    lawyerContact: string;
    court: string;
  }>([
    { type: 'input', name: 'title', message: '案件标题:', default: id },
    {
      type: 'list',
      name: 'cause',
      message: '案由:',
      choices: ['网络侵权名誉权', '传统媒体名誉权', '其他名誉权纠纷'],
      default: '网络侵权名誉权',
    },
    { type: 'input', name: 'defendantName', message: '被告 (您的当事人) 姓名/名称:', validate: (s: string) => (s ? true : '必填') },
    { type: 'input', name: 'defendantId', message: '被告身份证号/统一社会信用代码 (选填):' },
    { type: 'input', name: 'defendantAddress', message: '被告住所地 (选填):' },
    { type: 'input', name: 'defendantContact', message: '被告联系电话 (选填):' },
    { type: 'input', name: 'lawyerName', message: '律师姓名 (选填):' },
    { type: 'input', name: 'lawyerContact', message: '律师电话 (选填):' },
    { type: 'input', name: 'court', message: '管辖法院 (选填, 拆解起诉状可自动获取):' },
  ]);

  const input: CaseInput = {
    id,
    title: a.title,
    cause: a.cause,
    plaintiff: {
      name: '[待补充: 由起诉状拆解回填]',
      role: '原告',
    },
    defendant: {
      name: a.defendantName,
      role: '被告',
      idNumber: a.defendantId || undefined,
      address: a.defendantAddress || undefined,
      contact: a.defendantContact || undefined,
    },
    lawyer:
      a.lawyerName
        ? { name: a.lawyerName, role: '律师', contact: a.lawyerContact || undefined }
        : undefined,
    facts: '',
    claims: [],
    evidence: [],
    court: a.court || undefined,
  };

  const c = createCase(config, input);
  out.success(`案件已创建: ${c.id}`);
  out.info(`路径: ${caseDir(config, c.id)}`);
  out.dim('提示: 接下来可以:');
  out.dim(`  - dsh analyze-complaint 起诉状.pdf --case ${c.id}   拆解起诉状, 自动回填原告/诉请/事实/法院`);
  out.dim(`  - dsh generate defense --case ${c.id} --draft       生成答辩状`);
  out.dim('  - 手动编辑 case.json 补充证据清单');
}

export function caseListCommand(): void {
  const config = loadConfig();
  const list = listCases(config);
  if (list.length === 0) {
    out.info('暂无案件, 用 `dsh case new <id>` 创建');
    return;
  }
  out.info(`共 ${list.length} 个案件:`);
  for (const c of list) {
    // eslint-disable-next-line no-console
    console.log(`  ${c.id.padEnd(20)} ${c.title}  (${c.cause})`);
  }
}

export function caseShowCommand(id: string): void {
  const config = loadConfig();
  const c = loadCase(config, id);
  if (!c) {
    die(`案件不存在: ${id}`);
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(c, null, 2));
}
