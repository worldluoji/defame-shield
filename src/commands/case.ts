/**
 * dsh case new — 交互式创建案件
 * dsh case list — 列出所有案件 (含流水线阶段)
 * dsh case show <id> — 案件详情: 流水线状态 + 残留占位符 + 推荐下一步
 */
import inquirer from 'inquirer';
import { loadConfig } from '../config/config.js';
import { caseDir, createCase, listCases, loadCase, updateCase } from '../case/case.js';
import { caseStage, deriveCaseStatus, nextStepCommands } from '../case/pipeline.js';
import { defenseDeadline, parseLooseDate } from '../utils/dates.js';
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
    servedAt: string;
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
    {
      type: 'input',
      name: 'servedAt',
      message: '收到起诉状副本日期 (选填, YYYY-MM-DD; 答辩期 15 日与管辖异议窗口倒计时用):',
      validate: (s: string) => !s || parseLooseDate(s) ? true : `无法解析日期: ${s} (例: 2026-09-20)`,
    },
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
    servedAt: a.servedAt?.trim() || undefined,
  };

  const c = createCase(config, input);
  out.success(`案件已创建: ${c.id}`);
  out.info(`路径: ${caseDir(config, c.id)}`);
  out.dim('提示: 接下来可以:');
  out.dim(`  - dsh analyze-complaint 起诉状.pdf --case ${c.id}   拆解起诉状, 自动回填原告/诉请/事实/法院`);
  out.dim(`  - dsh generate defense --case ${c.id} --draft       生成答辩状`);
  out.dim('  - 手动编辑 case.json 补充证据清单');
}

/**
 * dsh case set <id> <key> <value> — 白名单改被告侧手填字段。
 * 原告/诉请/事实不走这里 (应由 analyze-complaint --case 拆解回填, 避免重复录入)。
 */
const CASE_SET_KEYS = ['servedAt'] as const;

export function caseSetCommand(id: string, key: string, value: string): void {
  const config = loadConfig();
  const c = loadCase(config, id);
  if (!c) die(`案件不存在: ${id}`);
  if (!(CASE_SET_KEYS as readonly string[]).includes(key)) {
    die(
      `不支持修改字段: ${key}\n` +
        `  当前仅支持: ${CASE_SET_KEYS.join(', ')} (原告/诉请/事实请用 dsh analyze-complaint <起诉状> --case ${id} 自动回填)`,
    );
  }
  if (key === 'servedAt') {
    if (!parseLooseDate(value)) die(`无法解析日期: ${value} (例: 2026-09-20)`);
    c.servedAt = value.trim();
  }
  updateCase(config, c);
  out.success(`${id}: ${key} = ${c.servedAt}`);
  const dl = defenseDeadline(c.servedAt);
  if (dl) {
    out.info(`答辩期: 收到后第 ${dl.daysSince} 天, 剩 ${dl.remaining > 0 ? `${dl.remaining} 日` : '已届满'}`);
  }
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
    const st = deriveCaseStatus(config, c.id);
    const stage = caseStage(st);
    const badge = stage.label === '待补事实' ? `待补事实 (${stage.todo})` : stage.label;
    out.log(`  ${c.id.padEnd(20)} [${badge.padEnd(8)}] ${c.title}  (${c.cause})`);
  }
  out.dim('详情与下一步: dsh case show <id>');
}

export function caseShowCommand(id: string, flags: { json?: boolean } = {}): void {
  const config = loadConfig();
  const c = loadCase(config, id);
  if (!c) {
    die(`案件不存在: ${id}`);
  }
  if (flags.json) {
    out.log(JSON.stringify(c, null, 2));
    return;
  }

  const st = deriveCaseStatus(config, id);
  const stage = caseStage(st);
  out.info(`案件 ${c.id}: ${c.title}  (${c.cause})  /  阶段: ${stage.label}`);
  out.log(`  当事人: 原告 ${c.plaintiff.name} vs 被告 ${c.defendant.name}`);
  out.log(`  法院: ${c.court ?? '(未识别)'}  /  诉请: ${c.claims.length} 条  /  代理律师: ${c.lawyer?.name ?? '(未填)'}`);
  const dl = defenseDeadline(c.servedAt);
  if (dl) {
    if (dl.remaining < 0) {
      out.log(`  🔴 期限: ${dl.servedAt} 送达, 已过 ${dl.daysSince} 日 — 答辩期 (15 日) 已届满 ${-dl.remaining} 日`);
    } else if (dl.urgent) {
      out.log(`  🔴 期限: ${dl.servedAt} 送达, 第 ${dl.daysSince} 日 / 答辩期剩 ${dl.remaining} 日 — 管辖异议须同期提出, 逾期视为放弃`);
    } else {
      out.log(`  ⏰ 期限: ${dl.servedAt} 送达, 第 ${dl.daysSince} 日 / 答辩期剩 ${dl.remaining} 日`);
    }
  } else {
    out.dim(`  ⏰ 期限: 未记录收到起诉状副本日期 — 记录后显示答辩期/管辖异议窗口倒计时: dsh case set ${id} servedAt 2026-09-20`);
  }
  out.log('');
  out.log('  流水线状态:');
  out.log(`    [1] 起诉状    ${st.complaint ? '✓ complaint.md' : '✗ 缺 complaint.md (dsh convert <起诉状.pdf> --out data/cases/' + id + '/complaint.md 或誊抄)'}`);
  out.log(
    `    [2] 拆解      ${
      st.analysis
        ? `✓ ${st.analysis.mode ?? '(未知模式)'} / 置信度 ${st.analysis.confidence !== undefined ? (st.analysis.confidence * 100).toFixed(0) + '%' : '?'} / 诉请 ${st.analysis.claimsCount} 条`
        : '✗ 未拆解'
    }`,
  );
  out.log(`    [3] 答辩初稿  ${st.defenseDraft ? `✓ ${st.defenseDraft}` : '✗ 未生成'}`);
  out.log(`    [4] 修补版    ${st.defensePatched ? `✓ ${st.defensePatched}` : '— 未修补'}`);
  if (st.defenseDraft || st.defensePatched) {
    const ph = st.todo > 0 ? `🔴 ${st.todo} 处待补充` : `✓ 无待补充`;
    out.log(`    [5] 占位符    ${ph}${st.otherPlaceholders > 0 ? `  / 其他 [xxx] ${st.otherPlaceholders} 处` : ''}`);
  }

  const steps = nextStepCommands(st, id);
  out.log('');
  out.dim('推荐下一步:');
  for (const s of steps) {
    out.dim(`  ${s}`);
  }
}
