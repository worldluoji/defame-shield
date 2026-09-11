/**
 * dsh apply-fixes — 自检修补建议自动注入
 *
 * dsh apply-fixes <defense.md> --analysis <json> [--out <patched.md>]
 *
 * 先调 self-check, 然后根据漏洞类型自动注入修补段落.
 * 输出目标已存在且未 --yes 时拒绝覆盖 (exit 2) — 防重跑静默盖掉已确认的 patched 版。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { selfCheckDefense, applyFixes, type Vulnerability } from '../rebuttal/self-check.js';
import { out, die } from '../utils/console.js';
import { readJsonFile } from '../utils/json.js';
import type { ComplaintAnalysis } from '../analyzer/complaint-types.js';

export interface ApplyFixesFlags {
  analysis: string;
  out?: string;
  /** 仅注入 critical 风险, 跳过 high */
  criticalOnly?: boolean;
  /** 跳过 self-check, 直接基于已有漏洞列表注入 (漏洞列表 JSON 路径) */
  vulnerabilities?: string;
  /** 目标 patched 文件已存在时确认覆盖 */
  yes?: boolean;
}

export async function applyFixesCommand(defensePath: string, flags: ApplyFixesFlags): Promise<void> {
  if (!existsSync(defensePath)) die(`答辩状文件不存在: ${defensePath}`);
  if (!existsSync(flags.analysis)) die(`拆解结果文件不存在: ${flags.analysis}`);

  const defense = readFileSync(defensePath, 'utf-8');
  const analysis = readJsonFile<ComplaintAnalysis>(flags.analysis);

  // 0. 覆盖防护: 目标已存在且未 --yes → 分流指引, 不做任何写入 (也省掉白跑的自检)
  const outPath = flags.out ?? join(
    dirname(defensePath),
    basename(defensePath, '.md') + '-patched.md',
  );
  if (existsSync(outPath) && !flags.yes) {
    out.warn(`目标 patched 文件已存在, 未执行任何操作: ${outPath}`);
    out.log('  两种情况, 请确认后选择:');
    out.log(`  (a) 重打基线版 → 覆盖该 patched 文件:  加 --yes 重跑`);
    out.log(`  (b) 在已有 patched 版上续补 → 把它作为输入, 输出换个新文件名 (不要 --yes):`);
    out.log(`      dsh apply-fixes ${outPath} --analysis ${flags.analysis} --out <新文件名>.md`);
    process.exitCode = 2;
    return;
  }

  // 1. 跑自检 (除非用户直接传漏洞列表)
  let vulns: Vulnerability[];
  if (flags.vulnerabilities && existsSync(flags.vulnerabilities)) {
    vulns = readJsonFile<Vulnerability[]>(flags.vulnerabilities);
    out.info(`使用已有漏洞列表: ${flags.vulnerabilities} (${vulns.length} 个)`);
  } else {
    out.info(`自检 + 注入: ${basename(defensePath)}  /  模式: rule`);
    const result = await selfCheckDefense({ defense, analysis, mode: 'rule' });
    vulns = flags.criticalOnly
      ? result.vulnerabilities.filter((v) => v.risk === 'critical')
      : result.vulnerabilities;
    out.info(`自检: ${result.vulnerabilities.length} 个漏洞,  注入: ${vulns.length} 个 (criticalOnly=${flags.criticalOnly ?? false})`);
  }

  // 2. 案件信息取自拆解结果 (无 --case 关联, 缺失时用中性称谓)
  // 3. 注入修补
  const result = applyFixes(defense, vulns, analysis, {
    caseName: analysis.cause ?? '',
    defendantName: analysis.parties?.被告?.name ?? '被告',
  });

  // 4. 写文件 (outPath 已在覆盖防护处解析)
  const outDir = dirname(outPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, result.patched, 'utf-8');

  out.success(`已写入: ${outPath}`);
  out.info(`注入修补段落: ${result.injectedCount} 个`);
  if (result.summary !== '无需修补') {
    out.dim('修补摘要:');
    for (const line of result.summary.split('\n').slice(0, 5)) {
      out.dim(`  ${line}`);
    }
  }
}
