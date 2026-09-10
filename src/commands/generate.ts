/**
 * dsh generate <type> --case <id> — 生成文书
 * dsh generate defense --from-analysis <json>  — 基于拆解结果生成答辩状
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config/config.js';
import { loadCase, outputsDir } from '../case/case.js';
import { generateDocument } from '../generators/generate.js';
import { generateDefense } from '../generators/defense.js';
import { out, die } from '../utils/console.js';
import { readJsonFile } from '../utils/json.js';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type DocumentType } from '../types.js';
import type { ComplaintAnalysis } from '../analyzer/complaint-types.js';

export interface GenerateFlags {
  case?: string;
  draft?: boolean;
  provider?: string;
  output?: string;
  extra?: string;
  /** 拆解结果 JSON 路径 (仅 defense 适用) */
  fromAnalysis?: string;
}

export async function generateCommand(type: string, flags: GenerateFlags): Promise<void> {
  if (!DOCUMENT_TYPES.includes(type as DocumentType)) {
    die(
      `不支持的文书类型: ${type}\n` +
        `支持的: ${DOCUMENT_TYPES.map((t) => `${t} (${DOCUMENT_TYPE_LABELS[t]})`).join(', ')}`,
    );
  }

  // 答辩状的特殊路径: --from-analysis
  if (type === 'defense' && flags.fromAnalysis) {
    await generateDefenseFromAnalysis(flags);
    return;
  }

  if (!flags.case) {
    die('必须指定 --case <id>');
  }

  const config = loadConfig();
  const c = loadCase(config, flags.case);
  if (!c) {
    die(`案件不存在: ${flags.case}`);
  }

  const outDir = outputsDir(config, c.id);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const draft = flags.draft || !config.llmEnabled;
  out.info(`生成 ${DOCUMENT_TYPE_LABELS[type as DocumentType]}  /  案件: ${c.id}  /  模式: ${draft ? 'draft (纯模板)' : 'AI 增强'}`);

  const result = await generateDocument({
    case: c,
    type: type as DocumentType,
    draft,
    provider: flags.provider as 'deepseek' | 'minimax' | undefined,
    extraInstruction: flags.extra,
  });

  if (!result.ok) {
    out.error(result.error);
    if (result.draftFallback) {
      out.warn('已 fallback 到 draft 模式, 保存到 outputs/');
      writeOutput(outDir, type, c.id, result.draftFallback.content, flags.output);
    }
    process.exit(1);
  }

  writeOutput(outDir, type, c.id, result.content, flags.output);
  out.success(`已生成  (${result.mode === 'ai' ? 'AI 润色' : 'draft 纯模板'},  耗时 ${result.elapsedMs}ms)`);
  out.dim(`查看: cat ${outDir}`);
}

async function generateDefenseFromAnalysis(flags: GenerateFlags): Promise<void> {
  if (!flags.fromAnalysis) die('必须指定 --from-analysis <json>');
  if (!existsSync(flags.fromAnalysis)) die(`拆解结果文件不存在: ${flags.fromAnalysis}`);

  const analysis = readJsonFile<ComplaintAnalysis>(flags.fromAnalysis);
  const config = loadConfig();
  const c = flags.case ? loadCase(config, flags.case) : null;
  if (!c) {
    die(`--from-analysis 生成答辩状必须同时指定 --case <id> (提供被告方信息)\n  建案: dsh case new <id> && dsh analyze-complaint 起诉状.md --case <id> (自动回填原告/诉请/事实)`);
  }

  const outDir = outputsDir(config, c.id);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const draft = flags.draft || !config.llmEnabled;
  out.info(`生成 民事答辩状  /  案件: ${c.id}  /  基于拆解: ${flags.fromAnalysis}  /  模式: ${draft ? 'draft' : 'AI 润色'}`);

  const result = await generateDefense({
    analysis,
    case: c,
    draft,
    provider: flags.provider as 'deepseek' | 'minimax' | undefined,
    extraInstruction: flags.extra,
  });

  if (!result.ok) {
    out.error(result.error);
    if (result.draftFallback) {
      out.warn('已 fallback 到 draft 模式, 保存到 outputs/');
      writeOutput(outDir, 'defense', c.id, result.draftFallback, flags.output);
    }
    process.exit(1);
  }

  writeOutput(outDir, 'defense', c.id, result.content, flags.output);
  out.success(`已生成答辩状  (${result.mode === 'ai' ? 'AI 润色' : 'draft'},  ${result.strategies.length} 个反点,  ${result.caseRefs.length} 条类案参考)`);
  out.dim(`查看: cat ${outDir}`);
}

function writeOutput(outDir: string, type: string, caseId: string, content: string, customPath?: string): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = customPath || `${type}-${ts}.md`;
  const full = join(outDir, filename);
  writeFileSync(full, content, 'utf-8');
  out.success(`已写入: ${full}`);
}
