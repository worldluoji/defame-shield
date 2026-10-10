/**
 * pipeline.ts 单元测试 — 案件产物定位 + 流水线状态推导 (纯文件系统, 不依赖 cwd)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  analysisPathInCase,
  findAnalysisInCase,
  findDefenseDraft,
  findDefensePatched,
  deriveCaseStatus,
  caseStage,
} from '../src/case/pipeline';
import type { DshConfig } from '../src/config/config';

let root: string;
let config: DshConfig;
const CASE_ID = 't-001';

function p(...segs: string[]): string {
  return join(root, 'data/cases', CASE_ID, ...segs);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-pipeline-'));
  config = {
    projectRoot: root,
    casesDir: 'data/cases',
    outputsDir: 'outputs',
    author: '',
    llmEnabled: false,
  };
  mkdirSync(p('outputs'), { recursive: true });
  writeFileSync(p('case.json'), JSON.stringify({ id: CASE_ID, createdAt: new Date().toISOString() }), 'utf-8');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('findAnalysisInCase', () => {
  it('拆解 JSON 固定位于案件目录', () => {
    expect(analysisPathInCase(config, CASE_ID)).toBe(p('complaint-analysis.json'));
    expect(findAnalysisInCase(config, CASE_ID)).toBe(null);
    writeFileSync(p('complaint-analysis.json'), '{}', 'utf-8');
    expect(findAnalysisInCase(config, CASE_ID)).toBe(p('complaint-analysis.json'));
  });
});

describe('findDefenseDraft / findDefensePatched', () => {
  it('当前稿 defense.md 优先于时间戳旧稿', () => {
    writeFileSync(p('outputs/defense-2026-01-01T00-00-00.md'), 'old', 'utf-8');
    writeFileSync(p('outputs/defense.md'), 'current', 'utf-8');
    expect(findDefenseDraft(config, CASE_ID)).toBe(p('outputs/defense.md'));
  });

  it('无 defense.md 时回退最新时间戳稿 (按 mtime, 排除 patched)', () => {
    const older = p('outputs/defense-2026-01-01T00-00-00.md');
    const newer = p('outputs/defense-2026-02-01T00-00-00.md');
    writeFileSync(older, 'a', 'utf-8');
    writeFileSync(newer, 'b', 'utf-8');
    writeFileSync(p('outputs/defense-2026-09-09T00-00-00-patched.md'), 'patched 不算初稿', 'utf-8');
    utimesSync(older, new Date('2026-01-01'), new Date('2026-01-01'));
    utimesSync(newer, new Date('2026-02-01'), new Date('2026-02-01'));
    expect(findDefenseDraft(config, CASE_ID)).toBe(newer);
  });

  it('patched 版定位: 稳定名优先, 回退最新 *-patched.md', () => {
    writeFileSync(p('outputs/defense-2026-01-01T00-00-00-patched.md'), 'old patch', 'utf-8');
    expect(findDefensePatched(config, CASE_ID)).toBe(p('outputs/defense-2026-01-01T00-00-00-patched.md'));
    writeFileSync(p('outputs/defense-patched.md'), 'stable', 'utf-8');
    expect(findDefensePatched(config, CASE_ID)).toBe(p('outputs/defense-patched.md'));
  });

  it('outputs 目录不存在时返回 null', () => {
    rmSync(p('outputs'), { recursive: true, force: true });
    expect(findDefenseDraft(config, CASE_ID)).toBe(null);
    expect(findDefensePatched(config, CASE_ID)).toBe(null);
  });
});

describe('deriveCaseStatus + caseStage', () => {
  it('空案件 → 待拆解', () => {
    const st = deriveCaseStatus(config, CASE_ID);
    expect(caseStage(st).label).toBe('待拆解');
  });

  it('有拆解无稿 → 可生成答辩状', () => {
    writeFileSync(
      p('complaint-analysis.json'),
      JSON.stringify({ mode: 'draft', confidence: 0.5, claims: [{ index: 1 }, { index: 2 }] }),
      'utf-8',
    );
    const st = deriveCaseStatus(config, CASE_ID);
    expect(st.analysis?.mode).toBe('draft');
    expect(st.analysis?.claimsCount).toBe(2);
    expect(caseStage(st).label).toBe('可生成答辩状');
  });

  it('初稿含 [待补充] → 待补事实并计数', () => {
    writeFileSync(p('complaint-analysis.json'), '{}', 'utf-8');
    writeFileSync(p('outputs/defense.md'), '事实: [待补充: 发帖时间]\n另: [账号ID]\n', 'utf-8');
    const st = deriveCaseStatus(config, CASE_ID);
    expect(st.todo).toBe(1);
    expect(st.otherPlaceholders).toBe(1);
    expect(caseStage(st)).toEqual({ label: '待补事实', todo: 1 });
  });

  it('无占位符 → 可自检修补; 有 patched → 已有修补版', () => {
    writeFileSync(p('complaint-analysis.json'), '{}', 'utf-8');
    writeFileSync(p('outputs/defense.md'), '干净稿', 'utf-8');
    expect(caseStage(deriveCaseStatus(config, CASE_ID)).label).toBe('可自检修补');
    writeFileSync(p('outputs/defense-patched.md'), '干净稿', 'utf-8');
    expect(caseStage(deriveCaseStatus(config, CASE_ID)).label).toBe('已有修补版');
  });

  it('拆解 JSON 损坏不抛错, 只保留存在事实', () => {
    writeFileSync(p('complaint-analysis.json'), '{ broken', 'utf-8');
    const st = deriveCaseStatus(config, CASE_ID);
    expect(st.analysis?.path).toBe(p('complaint-analysis.json'));
    expect(st.analysis?.mode).toBeUndefined();
  });
});
