/**
 * dsh simulate — 攻防推演
 *
 * dsh simulate [defense.md] [--analysis <json> | --case <id>] [--rounds 3] [--mode rule|ai]
 */
import { readFileSync } from 'node:fs';
import { simulateBattle, riskBand, type SimulationResult } from '../rebuttal/simulator.js';
import { checkAllStatutes } from '../data/statutes.js';
import { loadConfig } from '../config/config.js';
import { loadCase } from '../case/case.js';
import { resolveAnalysisPath, resolveDefensePath } from '../case/pipeline.js';
import { confirmCloudDisclosure } from '../utils/cloud-consent.js';
import { out, die } from '../utils/console.js';
import { readJsonFile, writeJsonFile } from '../utils/json.js';
import type { ComplaintAnalysis } from '../analyzer/complaint-types.js';
import type { Case } from '../case/types.js';

export interface SimulateFlags {
  /** 拆解结果 JSON 路径 (省略时从 --case 定位) */
  analysis?: string;
  case?: string;
  /** commander 经 parseInt 后为 number */
  rounds?: number;
  mode?: 'rule' | 'ai';
  provider?: string;
  out?: string;
}

export async function simulateCommand(defensePath: string | undefined, flags: SimulateFlags): Promise<void> {
  const resolvedDefense = resolveDefensePath(defensePath, flags.case);
  const resolvedAnalysis = resolveAnalysisPath(flags.analysis, flags.case);
  if (flags.rounds !== undefined && (!Number.isInteger(flags.rounds) || flags.rounds < 1)) {
    die(`--rounds 必须是 ≥1 的整数, 收到: ${flags.rounds}`);
  }
  if (flags.mode && !['rule', 'ai'].includes(flags.mode)) {
    die(`非法 --mode: ${flags.mode} (可选: rule | ai)`);
  }

  const defense = readFileSync(resolvedDefense, 'utf-8');
  const analysis = readJsonFile<ComplaintAnalysis>(resolvedAnalysis);

  // 案件信息
  const config = loadConfig();
  let c: Case;
  if (flags.case) {
    const loaded = loadCase(config, flags.case);
    if (!loaded) die(`案件不存在: ${flags.case}`);
    c = loaded;
  } else {
    // 兜底: 从 analysis.parties 推断
    const plaintiff = analysis.parties?.原告;
    const defendant = analysis.parties?.被告;
    if (!plaintiff?.name || !defendant?.name) {
      die('未指定 --case 时, 拆解结果必须含 原告/被告 姓名 (analysis.parties)');
    }
    c = {
      id: 'sim-' + Date.now(),
      title: `推演: ${plaintiff.name} vs ${defendant.name}`,
      cause: (analysis.cause ?? '其他名誉权纠纷') as Case['cause'],
      plaintiff,
      defendant,
      facts: analysis.facts?.tortContent ?? '',
      claims: [],
      evidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  let mode: 'rule' | 'ai' = flags.mode ?? 'rule';
  if (mode === 'ai' && !(await confirmCloudDisclosure(flags.provider))) {
    mode = 'rule';
  }

  out.info(`推演: ${c.title}  /  轮数: ${flags.rounds ?? 3}  /  模式: ${mode}`);
  if (c.evidence.length > 0) {
    out.warn(`已登记 ${c.evidence.length} 项证据参与推演 — 仅文字描述未核验原件, 按"证据客观存在且经质证成立"假设评估 (截图到手后请复核)`);
  }

  const result = await simulateBattle({
    case: c,
    analysis,
    defense,
    rounds: flags.rounds ?? 3,
    mode,
    provider: flags.provider as 'deepseek' | 'minimax' | undefined,
  });

  // 输出 JSON
  if (flags.out) {
    writeJsonFile(flags.out, result);
    out.success(`已写入: ${flags.out}`);
  }

  // 控制台输出
  printBattle(result);

  // 法条版本检查
  if (analysis.legalBasisItems && analysis.legalBasisItems.length > 0) {
    out.info('---');
    out.info('法条版本检查:');
    const checks = checkAllStatutes(analysis.legalBasisItems);
    for (const c of checks) {
      const icon = c.status === 'found' ? '✅' : c.status === 'expired' ? '⚠️' : '❓';
      out.log(`  ${icon} ${c.id}  - ${c.advice}`);
    }
  }
}

function printBattle(r: SimulationResult): void {
  // rule 模式: 内部 0-100 启发式评分不配精确百分比 — 展示为定性风险档 (非预测)
  if (r.mode === 'rule') {
    // Round 0 为未答辩基线, 走势自 Round 1 起算
    out.info(`风险走势 (自被告答辩起): ${r.trajectory.slice(1).map((n) => riskBand(n)).join(' → ')}`);
  } else {
    out.info(`被告胜诉轨迹: ${r.trajectory.map((n) => `${n}%`).join(' → ')}`);
  }
  out.info(`趋势: ${trendLabel(r.trend)}  /  关键转折: ${r.pivotRound !== undefined ? `Round ${r.pivotRound}` : '无'}`);

  out.log('');
  for (const round of r.rounds) {
    const sideIcon = round.side === '原告' ? '🔴' : '🔵';
    const probLabel =
      r.mode === 'rule'
        ? `态势: ${round.index === 0 ? '基线 (未答辩)' : riskBand(round.defendantWinProb)}`
        : `被告胜诉 ${round.defendantWinProb}%`;
    out.log(`--- Round ${round.index} | ${sideIcon} ${round.side} | ${round.type} | ${probLabel} ---`);
    for (const kp of round.keyPoints) {
      out.log(`  • ${kp}`);
    }
    if (round.evidenceGaps.length > 0) {
      out.log(`  ⚠️ 证据缺口:`);
      for (const eg of round.evidenceGaps) {
        out.log(`    - ${eg}`);
      }
    }
    out.log(`  💡 下一步: ${round.nextAction}`);
    out.log('');
  }

  out.info('=== 整体建议 ===');
  for (const line of r.overallAdvice.split('\n')) {
    out.info(`  ${line}`);
  }
}

function trendLabel(t: 'improving' | 'stable' | 'worsening'): string {
  if (t === 'improving') return '📈 改善 (对被告更有利)';
  if (t === 'worsening') return '📉 恶化 (对被告更不利)';
  return '➡️ 稳定';
}
