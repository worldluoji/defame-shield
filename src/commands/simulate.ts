/**
 * dsh simulate — 攻防推演
 *
 * dsh simulate <defense.md> --analysis <json> --case <id> [--rounds 3] [--mode rule|ai]
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { simulateBattle, type SimulationResult } from '../rebuttal/simulator.js';
import { checkAllStatutes } from '../data/statutes.js';
import { loadConfig } from '../config/config.js';
import { loadCase } from '../case/case.js';
import { out, die } from '../utils/console.js';

export interface SimulateFlags {
  analysis: string;
  case?: string;
  rounds?: number;
  mode?: 'rule' | 'ai';
  provider?: string;
  out?: string;
}

export async function simulateCommand(defensePath: string, flags: SimulateFlags): Promise<void> {
  if (!existsSync(defensePath)) die(`答辩状文件不存在: ${defensePath}`);
  if (!existsSync(flags.analysis)) die(`拆解结果文件不存在: ${flags.analysis}`);

  const defense = readFileSync(defensePath, 'utf-8');
  const analysis = JSON.parse(readFileSync(flags.analysis, 'utf-8'));

  // 案件信息
  const config = loadConfig();
  let c;
  if (flags.case) {
    c = loadCase(config, flags.case);
    if (!c) die(`案件不存在: ${flags.case}`);
  } else {
    // 兜底: 从 analysis.parties.被告.name 推断
    c = {
      id: 'sim-' + Date.now(),
      title: `推演: ${analysis.parties.原告.name} vs ${analysis.parties.被告.name}`,
      cause: analysis.cause,
      plaintiff: analysis.parties.原告,
      defendant: analysis.parties.被告,
      facts: analysis.facts.tortContent ?? '',
      claims: [],
      evidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  out.info(`推演: ${c.title}  /  轮数: ${flags.rounds ?? 3}  /  模式: ${flags.mode ?? 'rule'}`);

  const result = await simulateBattle({
    case: c,
    analysis,
    defense,
    rounds: flags.rounds ?? 3,
    mode: flags.mode,
    provider: flags.provider as 'deepseek' | 'minimax' | undefined,
  });

  // 输出 JSON
  if (flags.out) {
    const outDir = dirname(flags.out);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(flags.out, JSON.stringify(result, null, 2), 'utf-8');
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
      // eslint-disable-next-line no-console
      console.log(`  ${icon} ${c.id}  - ${c.advice}`);
    }
  }
}

function printBattle(r: SimulationResult): void {
  out.info(`被告胜诉轨迹: ${r.trajectory.map((n) => `${n}%`).join(' → ')}`);
  out.info(`趋势: ${trendLabel(r.trend)}  /  关键转折: ${r.pivotRound !== undefined ? `Round ${r.pivotRound}` : '无'}`);

  // eslint-disable-next-line no-console
  console.log('');
  for (const round of r.rounds) {
    const sideIcon = round.side === '原告' ? '🔴' : '🔵';
    // eslint-disable-next-line no-console
    console.log(`--- Round ${round.index} | ${sideIcon} ${round.side} | ${round.type} | 被告胜诉 ${round.defendantWinProb}% ---`);
    for (const kp of round.keyPoints) {
      // eslint-disable-next-line no-console
      console.log(`  • ${kp}`);
    }
    if (round.evidenceGaps.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`  ⚠️ 证据缺口:`);
      for (const eg of round.evidenceGaps) {
        // eslint-disable-next-line no-console
        console.log(`    - ${eg}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`  💡 下一步: ${round.nextAction}`);
    // eslint-disable-next-line no-console
    console.log('');
  }

  out.info('=== 整体建议 ===');
  for (const line of r.overallAdvice.split('\n')) {
    out.info(`  ${line}`);
  }
}

function trendLabel(t: 'improving' | 'stable' | 'worsening'): string {
  if (t === 'improving') return '📈 改善 (胜诉概率↑)';
  if (t === 'worsening') return '📉 恶化 (胜诉概率↓)';
  return '➡️ 稳定';
}
