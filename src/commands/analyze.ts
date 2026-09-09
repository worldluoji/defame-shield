/**
 * dsh analyze-complaint <file> — 拆解原告起诉状
 * 输出: ComplaintAnalysis JSON
 *
 * 支持输入: .md / .txt (直接) / .pdf / .docx (经 markitdown 转 md)
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { analyzeComplaint } from '../analyzer/complaint-parser.js';
import { DocumentConverter } from '../converters/document-converter.js';
import { detectFormat } from '../converters/format-detector.js';
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
  if (!existsSync(input)) die(`文件不存在: ${input}`);
  // 1. 检测格式
  const format = detectFormat(input);
  let textInput = input;

  // 2. 非 .md 格式 → 自动转 markdown (txt/md 由转换器 passthrough)
  if (format !== 'md' && format !== 'unsupported') {
    out.info(`检测到 ${format} 格式, 自动调用 MarkItDown 转换...`);
    const converter = new DocumentConverter();
    const result = await converter.convert(input);
    if (!result.ok) {
      out.error(result.error.error);
      if (result.error.installHint) {
        out.info('安装提示:');
        // eslint-disable-next-line no-console
        console.log(result.error.installHint);
      }
      process.exit(1);
    }
    // 把转换后的 markdown 写入临时文件 (或 --case 目录), 然后分析
    const tempMd = resolveTempMdPath(flags, input);
    writeFileSync(tempMd, result.result.markdown, 'utf-8');
    out.success(`已转换: ${tempMd}  (${result.result.metadata.converter}, ${result.result.metadata.durationMs ?? '?'}ms)`);
    textInput = tempMd;
  } else if (format === 'unsupported') {
    die(`不支持的文件格式: ${input}\n支持的格式: .md, .txt, .pdf, .docx, .pptx, .xlsx, .html`);
  }

  out.info(`拆解起诉状: ${basename(textInput)}  /  模式: ${flags.draft ? 'draft (关键词)' : 'AI'}`);

  const result = await analyzeComplaint(textInput, {
    draft: flags.draft,
    provider: flags.provider as 'deepseek' | 'minimax' | undefined,
    extraInstruction: flags.extra,
  });

  if (!result.ok) {
    out.error(result.error);
    if (result.partialDraft) {
      out.warn('已 fallback 到 draft 模式, 保存到 out 指定路径');
      const outPath = resolveOutPath(flags, textInput);
      writeOutput(outPath, result.partialDraft);
    }
    process.exit(1);
  }

  // 输出路径
  const outPath = resolveOutPath(flags, textInput);
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

function resolveTempMdPath(flags: AnalyzeFlags, input: string): string {
  // 转换后的临时 md 放在 case 目录 (如果 --case 指定) 或 同级目录
  if (flags.case) {
    const config = loadConfig();
    const dir = caseDir(config, flags.case);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, 'complaint.md');
  }
  const dir = dirname(input);
  const base = basename(input).replace(/\.[^./\\]+$/, '');
  return join(dir, `${base}.converted.md`);
}

function resolveOutPath(flags: AnalyzeFlags, input: string): string {
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
