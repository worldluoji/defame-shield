/**
 * 案件目录管理 — case = data/cases/<id>/
 *   ├── case.json   案件数据
 *   └── outputs/    生成的文书
 */
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Case, CaseInput } from './types.js';
import type { ComplaintAnalysis } from '../analyzer/complaint-types.js';
import { getCasesDir, type DshConfig } from '../config/config.js';

/** 案件 ID 白名单 — 防止 join 时路径穿越 */
const CASE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function caseDir(config: DshConfig, caseId: string): string {
  if (!CASE_ID_RE.test(caseId)) {
    throw new Error(`非法案件 ID: "${caseId}" (仅允许字母/数字/下划线/连字符)`);
  }
  return join(getCasesDir(config), caseId);
}

export function outputsDir(config: DshConfig, caseId: string): string {
  return join(caseDir(config, caseId), config.outputsDir);
}

export function caseJsonPath(config: DshConfig, caseId: string): string {
  return join(caseDir(config, caseId), 'case.json');
}

/** 列出所有案件 (按 createdAt 降序) */
export function listCases(config: DshConfig): Case[] {
  const dir = getCasesDir(config);
  if (!existsSync(dir)) return [];
  const entries: Case[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    const json = join(full, 'case.json');
    if (!existsSync(json)) continue;
    try {
      const c = JSON.parse(readFileSync(json, 'utf-8')) as Partial<Case>;
      if (typeof c?.id !== 'string' || typeof c?.createdAt !== 'string') continue;
      entries.push(c as Case);
    } catch {
      // skip invalid case.json
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function loadCase(config: DshConfig, caseId: string): Case | null {
  const path = caseJsonPath(config, caseId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Case;
  } catch (e) {
    throw new Error(`case.json 解析失败: ${path}\n  ${(e as Error).message}`);
  }
}

/** 创建案件目录 + 写 case.json (以 case.json 是否存在判断案件已创建, 允许目录由 analyze --case 预先建立) */
export function createCase(config: DshConfig, input: CaseInput): Case {
  const dir = caseDir(config, input.id);
  if (existsSync(caseJsonPath(config, input.id))) {
    throw new Error(`案件已存在: ${input.id}\n  路径: ${dir}`);
  }
  mkdirSync(dir, { recursive: true });
  mkdirSync(outputsDir(config, input.id), { recursive: true });
  const now = new Date().toISOString();
  const c: Case = {
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  writeFileSync(caseJsonPath(config, input.id), JSON.stringify(c, null, 2) + '\n', 'utf-8');
  return c;
}

/** 更新案件 (写回 case.json) */
export function updateCase(config: DshConfig, c: Case): Case {
  const path = caseJsonPath(config, c.id);
  const updated = { ...c, updatedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  return updated;
}

const CAUSES: ReadonlyArray<Case['cause']> = ['网络侵权名誉权', '传统媒体名誉权', '其他名誉权纠纷'];

/**
 * 起诉状拆解结果回填案件 (纯函数, 返回新对象):
 * 起诉状是权威来源 — 原告/诉请/案由直接覆盖;
 * 被告/法院/律师仅补齐空缺字段 (以人工填写为准, "[待补充" 占位视为空)。
 */
export function mergeAnalysisIntoCase(c: Case, a: ComplaintAnalysis): Case {
  const isBlank = (s: string | undefined) => !s || s.startsWith('[待补充');
  const p = a.parties.原告;
  const d = a.parties.被告;

  const factsParts = [a.facts.time, a.facts.tortMethod, a.facts.place, a.facts.tortContent, a.facts.spread]
    .filter((x): x is string => Boolean(x && x.trim() && !x.includes('未识别')))
    .map((x) => x.trim());

  return {
    ...c,
    cause: (CAUSES as ReadonlyArray<string>).includes(a.cause) ? (a.cause as Case['cause']) : c.cause,
    plaintiff: {
      name: p.name || c.plaintiff.name,
      role: '原告',
      idNumber: p.idNumber ?? c.plaintiff.idNumber,
      address: p.address ?? c.plaintiff.address,
      contact: p.contact ?? c.plaintiff.contact,
    },
    defendant: {
      ...c.defendant,
      name: isBlank(c.defendant.name) ? (d.name || c.defendant.name) : c.defendant.name,
      idNumber: isBlank(c.defendant.idNumber) ? d.idNumber : c.defendant.idNumber,
      address: isBlank(c.defendant.address) ? d.address : c.defendant.address,
      contact: isBlank(c.defendant.contact) ? d.contact : c.defendant.contact,
    },
    lawyer:
      c.lawyer ?? (a.parties.律师 ? { ...a.parties.律师, role: '律师' as const } : undefined),
    facts: isBlank(c.facts) ? factsParts.join('; ').slice(0, 500) : c.facts,
    claims: a.claims.length > 0 ? a.claims.map((cl) => ({ content: cl.content, amount: cl.amount })) : c.claims,
    court: isBlank(c.court) ? a.courtOfFiling : c.court,
  };
}
