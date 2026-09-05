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

  const a = await inquirer.prompt<{
    title: string;
    cause: CaseInput['cause'];
    plaintiffName: string;
    plaintiffId: string;
    plaintiffAddress: string;
    plaintiffContact: string;
    defendantName: string;
    defendantId: string;
    defendantAddress: string;
    defendantContact: string;
    lawyerName: string;
    lawyerContact: string;
    facts: string;
    court: string;
  }>([
    { type: 'input', name: 'title', message: '案件标题:', validate: (s: string) => (s ? true : '必填') },
    {
      type: 'list',
      name: 'cause',
      message: '案由:',
      choices: ['网络侵权名誉权', '传统媒体名誉权', '其他名誉权纠纷'],
      default: '网络侵权名誉权',
    },
    { type: 'input', name: 'plaintiffName', message: '原告姓名/名称:', validate: (s: string) => (s ? true : '必填') },
    { type: 'input', name: 'plaintiffId', message: '原告身份证号/统一社会信用代码:' },
    { type: 'input', name: 'plaintiffAddress', message: '原告住所地:' },
    { type: 'input', name: 'plaintiffContact', message: '原告联系电话:' },
    { type: 'input', name: 'defendantName', message: '被告姓名/名称:', validate: (s: string) => (s ? true : '必填') },
    { type: 'input', name: 'defendantId', message: '被告身份证号/统一社会信用代码:' },
    { type: 'input', name: 'defendantAddress', message: '被告住所地:' },
    { type: 'input', name: 'defendantContact', message: '被告联系电话:' },
    { type: 'input', name: 'lawyerName', message: '律师姓名 (选填):' },
    { type: 'input', name: 'lawyerContact', message: '律师电话 (选填):' },
    {
      type: 'editor',
      name: 'facts',
      message: '事实摘要 (侵权时间/方式/内容/后果, 换行后保存退出):',
      validate: (s: string) => (s && s.length > 20 ? true : '至少 20 字'),
    },
    { type: 'input', name: 'court', message: '管辖法院 (选填):' },
  ]);

  // 简单解析 evidence 空数组 (MVP 阶段, 证据清单后续通过 case.json 手动编辑或 `dsh case evidence add` 扩展)
  const input: CaseInput = {
    id,
    title: a.title,
    cause: a.cause,
    plaintiff: {
      name: a.plaintiffName,
      role: '原告',
      idNumber: a.plaintiffId || undefined,
      address: a.plaintiffAddress || undefined,
      contact: a.plaintiffContact || undefined,
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
    facts: a.facts,
    claims: [
      { content: '依法判令被告立即停止对原告名誉权的侵害' },
      { content: '依法判令被告公开赔礼道歉、消除影响、恢复名誉' },
      { content: '依法判令被告赔偿原告因维权所支出的合理费用' },
      { content: '依法判令被告赔偿原告精神损害抚慰金' },
      { content: '依法判令被告承担本案全部诉讼费、公告费等诉讼费用' },
    ],
    evidence: [],
    court: a.court || undefined,
  };

  const c = createCase(config, input);
  out.success(`案件已创建: ${c.id}`);
  out.info(`路径: ${caseDir(config, c.id)}`);
  out.dim('提示: 接下来可以:');
  out.dim('  - 手动编辑 case.json 补充证据清单');
  out.dim('  - dsh generate letter --case <id>   生成律师函');
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
