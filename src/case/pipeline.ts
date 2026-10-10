/**
 * 案件产物的"位置唯一源" — 下游命令给 --case <id> 即可自动定位, 不再手动传长路径:
 *   拆解结果: data/cases/<id>/complaint-analysis.json (analyze-complaint --case 固定写到此处)
 *   答辩状当前稿: outputs/defense.md (generate 覆盖旧版前归档到 outputs/history/)
 * 兼容旧命名 (defense-<时间戳>.md): 无 defense.md 时按 mtime 取最新。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, type DshConfig } from '../config/config.js';
import { caseDir, outputsDir } from './case.js';
import { die } from '../utils/console.js';
import { scanPlaceholders } from '../utils/placeholders.js';
import type { ComplaintAnalysis } from '../analyzer/complaint-types.js';

export function analysisPathInCase(config: DshConfig, caseId: string): string {
  return join(caseDir(config, caseId), 'complaint-analysis.json');
}

export function findAnalysisInCase(config: DshConfig, caseId: string): string | null {
  const p = analysisPathInCase(config, caseId);
  return existsSync(p) ? p : null;
}

function newestDefenseMd(dir: string, patched: boolean): string | null {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter(
    (n) =>
      n.startsWith('defense-') &&
      n.endsWith('.md') &&
      (n.endsWith('-patched.md') === patched),
  );
  if (names.length === 0) return null;
  names.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
  const first = names[0];
  return first ? join(dir, first) : null;
}

/** 答辩状当前稿: 优先 outputs/defense.md, 回退最新 defense-*.md (不含 patched) */
export function findDefenseDraft(config: DshConfig, caseId: string): string | null {
  const dir = outputsDir(config, caseId);
  const current = join(dir, 'defense.md');
  if (existsSync(current)) return current;
  return newestDefenseMd(dir, false);
}

/** patched 版: 优先 outputs/defense-patched.md, 回退最新 *-patched.md */
export function findDefensePatched(config: DshConfig, caseId: string): string | null {
  const dir = outputsDir(config, caseId);
  const current = join(dir, 'defense-patched.md');
  if (existsSync(current)) return current;
  return newestDefenseMd(dir, true);
}

/** 解析拆解 JSON 路径: 显式 --analysis 优先, 否则从 --case 案件目录定位; 失败 die 并给下一步 */
export function resolveAnalysisPath(explicit: string | undefined, caseId: string | undefined): string {
  if (explicit) {
    if (!existsSync(explicit)) die(`拆解结果文件不存在: ${explicit}`);
    return explicit;
  }
  if (caseId) {
    const p = findAnalysisInCase(loadConfig(), caseId);
    if (p) return p;
    die(
      `案件 ${caseId} 尚无拆解结果 (complaint-analysis.json)\n` +
        `  下一步: dsh analyze-complaint ${join(`data/cases/${caseId}`, 'complaint.md')} --case ${caseId} --draft`,
    );
  }
  die('必须指定拆解结果: 显式 JSON 路径 (位置参数 / --analysis) 或 --case <id> (自动定位案件目录)');
}

/** 解析答辩状路径: 显式位置参数优先, 否则从 --case 定位当前稿; 失败 die 并给下一步 */
export function resolveDefensePath(explicit: string | undefined, caseId: string | undefined): string {
  if (explicit) {
    if (!existsSync(explicit)) die(`答辩状文件不存在: ${explicit}`);
    return explicit;
  }
  if (caseId) {
    const p = findDefenseDraft(loadConfig(), caseId);
    if (p) return p;
    die(
      `案件 ${caseId} 尚无答辩状初稿\n` +
        `  下一步: dsh generate defense --case ${caseId}`,
    );
  }
  die('必须指定答辩状路径或 --case <id> (自动定位 outputs/ 下当前稿)');
}

// ---------- 流水线状态 (供 case list / case show) ----------

export interface AnalysisSummary {
  path: string;
  mode?: 'ai' | 'draft';
  confidence?: number;
  filingDate?: string;
  claimsCount: number;
}

export interface CaseStatus {
  /** 案件目录不存在 */
  missing: boolean;
  hasCaseJson: boolean;
  complaint: string | null;
  analysis: AnalysisSummary | null;
  defenseDraft: string | null;
  defensePatched: string | null;
  /** 当前稿 (无初稿则取 patched) 中 [待补充] 数量 */
  todo: number;
  /** 其他 [xxx] 短占位符数量 */
  otherPlaceholders: number;
}

export function deriveCaseStatus(config: DshConfig, caseId: string): CaseStatus {
  const dir = caseDir(config, caseId);
  const complaintPath = join(dir, 'complaint.md');
  const analysisPath = findAnalysisInCase(config, caseId);

  let analysis: AnalysisSummary | null = null;
  if (analysisPath) {
    analysis = { path: analysisPath, claimsCount: 0 };
    try {
      const a = JSON.parse(readFileSync(analysisPath, 'utf-8')) as Partial<ComplaintAnalysis>;
      analysis.mode = a.mode;
      analysis.confidence = a.confidence;
      analysis.filingDate = a.filingDate;
      analysis.claimsCount = a.claims?.length ?? 0;
    } catch {
      // 文件损坏: 只保留"存在"事实
    }
  }

  const defenseDraft = findDefenseDraft(config, caseId);
  const defensePatched = findDefensePatched(config, caseId);
  let todo = 0;
  let otherPlaceholders = 0;
  const target = defenseDraft ?? defensePatched;
  if (target) {
    try {
      const items = scanPlaceholders(readFileSync(target, 'utf-8'));
      todo = items.filter((i) => i.kind === 'todo').length;
      otherPlaceholders = items.length - todo;
    } catch {
      // 读取失败按 0 计
    }
  }

  return {
    missing: !existsSync(dir),
    hasCaseJson: existsSync(join(dir, 'case.json')),
    complaint: existsSync(complaintPath) ? complaintPath : null,
    analysis,
    defenseDraft,
    defensePatched,
    todo,
    otherPlaceholders,
  };
}

export type CaseStage =
  | { label: '未建案' }
  | { label: '待拆解' }
  | { label: '可生成答辩状' }
  | { label: '待补事实'; todo: number }
  | { label: '可自检修补' }
  | { label: '已有修补版' };

export function caseStage(st: CaseStatus): CaseStage {
  if (!st.hasCaseJson) return { label: '未建案' };
  if (!st.analysis) return { label: '待拆解' };
  if (!st.defenseDraft && !st.defensePatched) return { label: '可生成答辩状' };
  if (st.todo > 0) return { label: '待补事实', todo: st.todo };
  if (!st.defensePatched) return { label: '可自检修补' };
  return { label: '已有修补版' };
}

/** 推荐下一步命令 (按流水线阶段给 1-2 条; 供 case show) */
export function nextStepCommands(st: CaseStatus, caseId: string): string[] {
  const stage = caseStage(st);
  switch (stage.label) {
    case '未建案':
      return [`dsh case new ${caseId}`];
    case '待拆解': {
      const src = st.complaint ?? 'data/cases/' + caseId + '/complaint.md';
      return [`dsh analyze-complaint ${src} --case ${caseId} --draft`];
    }
    case '可生成答辩状':
      return [`dsh generate defense --case ${caseId} --draft`];
    case '待补事实':
      return [
        `dsh fill --case ${caseId} --set "路径=值" --allow-new  (缺口见拆解 JSON; agent 模式逐条追问)`,
        `重生成: dsh generate defense --case ${caseId}`,
      ];
    case '可自检修补':
      return [
        `dsh self-check --case ${caseId}`,
        `dsh apply-fixes --case ${caseId}`,
      ];
    case '已有修补版':
      return [
        `dsh simulate --case ${caseId}`,
        `dsh export-pdf ${st.defensePatched ?? st.defenseDraft}`,
      ];
  }
}
