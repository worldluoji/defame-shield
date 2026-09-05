/**
 * dsh analyze-complaint <file> — 拆解原告起诉状
 * 输出: ComplaintAnalysis JSON
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { analyzeComplaint } from '../analyzer/complaint-parser.js';
import { out, die } from '../utils/console.js';
import { loadConfig } from '../config/config.js';
import { caseDir } from '../case/case.js';

export interface AnalyzeFlags {
  draft?: boolean;
  provider?: string;
  out?: string;
  case?: string;
  extra?: string;
  /** 静默模式 (不输出 JSON, 只输出消息) */
  silent?: boolean;
}

export async function analyzeComplaintCommand(input: string, flags: AnalyzeFlags): Promise<void> {
  out.info(`拆解起诉状: ${input}  /  模式: ${flags.draft ? 'draft (关键词)' : 'AI'}`);

  const result = await analyzeComplaint(input, {
    draft: flags.draft,
    provider: flags.provider as 'deepseek' | 'minimax' | undefined,
    extraInstruction: flags.extra,
  });

  if (!result.ok) {
    out.error(result.error);
    if (result.partialDraft) {
      out.warn('已 fallback 到 draft 模式, 保存到 out 指定路径');
      const outPath = resolveOutPath(flags, input, true);
      writeOutput(outPath, result.partialDraft);
    }
    process.exit(1);
  }

  // 输出路径
  const outPath = resolveOutPath(flags, input, false);
  writeOutput(outPath, result.analysis);

  out.success(`已生成拆解结果: ${outPath}`);

  if (!flags.silent) {
    // 控制台也输出摘要
    const a = result.analysis;
    out.info(`置信度: ${(a.confidence * 100).toFixed(0)}%`);
    out.info(`诉请: ${a.claims.length} 条`);
    out.info(`法条: ${a.legalBasis.length} 条`);
    out.info(`警告: ${a.warnings.length === 0 ? '无' : a.warnings.join('; ')}`);
  }
}

function resolveOutPath(flags: AnalyzeFlags, input: string, isFallback: boolean): string {
  if (flags.out) return flags.out;

  // 默认: data/cases/<case-id>/complaint-analysis.json (如果 --case 指定)
  if (flags.case) {
    const config = loadConfig();
    const dir = caseDir(config, flags.case);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, 'complaint-analysis.json');
  }

  // 兜底: 与输入文件同目录, 文件名加 .analysis.json
  const dir = dirname(input);
  const base = basename(input).replace(/\.(md|txt)$/, '');
  return join(dir, `${base}.analysis.json`);
}

function writeOutput(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
