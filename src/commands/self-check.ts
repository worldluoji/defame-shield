/**
 * dsh self-check — 抗辩自检
 *
 * dsh self-check [defense.md] [--analysis <json> | --case <id>] [--mode rule|ai|hybrid]
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { selfCheckDefense, type CheckMode, type SelfCheckResult } from '../rebuttal/self-check.js';
import { out, die } from '../utils/console.js';
import { readJsonFile, writeJsonFile } from '../utils/json.js';
import { resolveAnalysisPath, resolveDefensePath } from '../case/pipeline.js';
import { confirmCloudDisclosure } from '../utils/cloud-consent.js';
import type { ComplaintAnalysis } from '../analyzer/complaint-types.js';

export interface SelfCheckFlags {
  /** 拆解结果 JSON 路径 (省略时从 --case 定位) */
  analysis?: string;
  /** 案件 ID: 自动定位当前稿答辩状与拆解 JSON */
  case?: string;
  /** 模式 */
  mode?: CheckMode;
  /** provider */
  provider?: string;
  /** 输出 JSON 路径 */
  out?: string;
  /** 仅输出 critical/high */
  severeOnly?: boolean;
}

export async function selfCheckCommand(defensePath: string | undefined, flags: SelfCheckFlags): Promise<void> {
  const resolvedDefense = resolveDefensePath(defensePath, flags.case);
  const resolvedAnalysis = resolveAnalysisPath(flags.analysis, flags.case);
  if (flags.mode && !['rule', 'ai', 'hybrid'].includes(flags.mode)) {
    die(`非法 --mode: ${flags.mode} (可选: rule | ai | hybrid)`);
  }

  const defense = readFileSync(resolvedDefense, 'utf-8');
  const analysis = readJsonFile<ComplaintAnalysis>(resolvedAnalysis);

  let mode: CheckMode = flags.mode ?? 'rule';
  if ((mode === 'ai' || mode === 'hybrid') && !(await confirmCloudDisclosure(flags.provider))) {
    mode = 'rule';
  }

  out.info(`自检答辩状: ${basename(resolvedDefense)}  /  基于拆解: ${basename(resolvedAnalysis)}  /  模式: ${mode}`);

  const result = await selfCheckDefense({
    defense,
    analysis,
    mode,
    provider: flags.provider as 'deepseek' | 'minimax' | undefined,
  });

  // 输出 JSON
  if (flags.out) {
    writeJsonFile(flags.out, result);
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

  out.log('');
  for (const v of displayVulns) {
    const icon = v.risk === 'critical' ? '🔴' : v.risk === 'high' ? '🟠' : v.risk === 'medium' ? '🟡' : '⚪';
    out.log(`${icon} [${v.risk.toUpperCase()}] ${v.attack}`);
    out.log(`   攻击: ${v.plaintiffArgument.slice(0, 100)}${v.plaintiffArgument.length > 100 ? '...' : ''}`);
    out.log(`   修补: ${v.suggestedFix.slice(0, 100)}${v.suggestedFix.length > 100 ? '...' : ''}`);
    if (v.legalBasis) {
      out.log(`   法条: ${v.legalBasis}`);
    }
    out.log('');
  }
}
