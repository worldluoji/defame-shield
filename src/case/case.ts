/**
 * 案件目录管理 — case = data/cases/<id>/
 *   ├── case.json   案件数据
 *   └── outputs/    生成的文书
 */
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Case, CaseInput } from './types.js';
import { getCasesDir, type DshConfig } from '../config/config.js';

export function caseDir(config: DshConfig, caseId: string): string {
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
      const c = JSON.parse(readFileSync(json, 'utf-8')) as Case;
      entries.push(c);
    } catch {
      // skip invalid case.json
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function loadCase(config: DshConfig, caseId: string): Case | null {
  const path = caseJsonPath(config, caseId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as Case;
}

/** 创建案件目录 + 写 case.json */
export function createCase(config: DshConfig, input: CaseInput): Case {
  const dir = caseDir(config, input.id);
  if (existsSync(dir)) {
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
