/**
 * dsh self-check — 抗辩自检
 *
 * dsh self-check <defense.md> --analysis <json> [--mode rule|ai|hybrid]
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { selfCheckDefense, type CheckMode, type SelfCheckResult } from '../rebuttal/self-check.js';
import { out, die } from '../utils/console.js';

export interface SelfCheckFlags {
  /** 拆解结果 JSON 路径 */
  analysis: string;
  /** 模式 */
  mode?: CheckMode;
  /** provider */
  provider?: string;
  /** 输出 JSON 路径 */
  out?: string;
  /** 仅输出 critical/high */
  severeOnly?: boolean;
}

export async function selfCheckCommand(defensePath: string, flags: SelfCheckFlags): Promise<void> {
  if (!existsSync(defensePath)) die(`答辩状文件不存在: ${defensePath}`);
  if (!existsSync(flags.analysis)) die(`拆解结果文件不存在: ${flags.analysis}`);

  const defense = readFileSync(defensePath, 'utf-8');
  const analysis = JSON.parse(readFileSync(flags.analysis, 'utf-8'));

  out.info(`自检答辩状: ${basename(defensePath)}  /  基于拆解: ${basename(flags.analysis)}  /  模式: ${flags.mode ?? 'rule'}`);

  const result = await selfCheckDefense({
    defense,
    analysis,
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
  printSummary(result, flags.severeOnly ?? false);
}

function printSummary(r: SelfCheckResult, severeOnly: boolean): void {
  const { vulnerabilities: vulns, overallScore, summary } = r;
  const displayVulns = severeOnly ? vulns.filter((v) => v.risk === 'critical' || v.risk === 'high') : vulns;

  out.info(`评分: ${overallScore}/100`);
  out.info(summary);
  out.info(`漏洞: 共 ${vulns.length} 个${severeOnly ? ` (仅显示 critical/high: ${displayVulns.length} 个)` : ''}`);

  // eslint-disable-next-line no-console
  console.log('');
  for (const v of displayVulns) {
    const icon = v.risk === 'critical' ? '🔴' : v.risk === 'high' ? '🟠' : v.risk === 'medium' ? '🟡' : '⚪';
    // eslint-disable-next-line no-console
    console.log(`${icon} [${v.risk.toUpperCase()}] ${v.attack}`);
    // eslint-disable-next-line no-console
    console.log(`   攻击: ${v.plaintiffArgument.slice(0, 100)}${v.plaintiffArgument.length > 100 ? '...' : ''}`);
    // eslint-disable-next-line no-console
    console.log(`   修补: ${v.suggestedFix.slice(0, 100)}${v.suggestedFix.length > 100 ? '...' : ''}`);
    if (v.legalBasis) {
      // eslint-disable-next-line no-console
      console.log(`   法条: ${v.legalBasis}`);
    }
    // eslint-disable-next-line no-console
    console.log('');
  }
}
