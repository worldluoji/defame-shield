/**
 * dsh fill 单元测试 — 纯函数核心 + 命令落盘行为
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyFillPatches, fillAnalysisCommand } from '../src/commands/fill-analysis';
import type { ComplaintAnalysis } from '../src/analyzer/complaint-types';

function mkAnalysis(): ComplaintAnalysis {
  return {
    source: 'test',
    analyzedAt: '2026-01-01',
    mode: 'draft',
    parties: {
      原告: { name: '张三', role: '原告' },
      被告: { name: '', role: '被告' },
    },
    cause: '名誉权纠纷',
    claims: [{ index: 1, content: '停止侵害', type: 'stop_infringement', amount: 5000 }],
    facts: { tortMethod: '微博', tortContent: '内容', spread: '' },
    evidence: [],
    legalBasis: [],
    legalBasisItems: [],
    elementScore: { factAuthenticity: 'unknown', directedness: 'medium', fault: 'unknown', damage: 'weak' },
    rebuttalPriority: [1],
    confidence: 0.5,
    warnings: [],
  };
}

describe('applyFillPatches', () => {
  it('回填已存在的字符串字段', () => {
    const a = mkAnalysis();
    const applied = applyFillPatches(a, [
      { path: 'parties.被告.name', value: '李四' },
      { path: 'facts.spread', value: '阅读量约 10 万' },
    ]);
    expect(applied.length).toBe(2);
    expect(a.parties.被告.name).toBe('李四');
    expect(a.facts.spread).toBe('阅读量约 10 万');
  });

  it('number 字段: 数字字符串转换; 非法数字拒绝', () => {
    const a = mkAnalysis();
    applyFillPatches(a, [{ path: 'claims.0.amount', value: '8000' }]);
    expect(a.claims[0]!.amount).toBe(8000);

    const b = mkAnalysis();
    expect(() => applyFillPatches(b, [{ path: 'claims.0.amount', value: '五千元' }])).toThrow(/不匹配/);
    expect(b.claims[0]!.amount).toBe(5000);
  });

  it('缺失的根级字段默认拒绝, --allow-new 放行', () => {
    const a = mkAnalysis();
    expect(a.filingDate).toBeUndefined();
    expect(() => applyFillPatches(a, [{ path: 'filingDate', value: '2026-08-20' }])).toThrow(/--allow-new/);
    expect(a.filingDate).toBeUndefined();

    const b = mkAnalysis();
    applyFillPatches(b, [{ path: 'filingDate', value: '2026-08-20' }], { allowNew: true });
    expect(b.filingDate).toBe('2026-08-20');
  });

  it('深层末端缺失 (facts.time): 默认拒绝, --allow-new 放行', () => {
    const a = mkAnalysis();
    expect(() => applyFillPatches(a, [{ path: 'facts.time', value: '2026-03-12' }])).toThrow(/facts.time/);
    const b = mkAnalysis();
    applyFillPatches(b, [{ path: 'facts.time', value: '2026-03-12' }], { allowNew: true });
    expect(b.facts.time).toBe('2026-03-12');
  });

  it('中间层路径缺失一律拒绝 (即使 --allow-new)', () => {
    const a = mkAnalysis();
    expect(() =>
      applyFillPatches(a, [{ path: 'nonexistent.deep', value: 'x' }], { allowNew: true }),
    ).toThrow(/nonexistent/);
    expect((a as unknown as Record<string, unknown>).nonexistent).toBeUndefined();
  });

  it('数组下标越界拒绝', () => {
    const a = mkAnalysis();
    expect(() => applyFillPatches(a, [{ path: 'claims.5.amount', value: '1' }])).toThrow(/越界/);
  });

  it('拒绝用标量覆盖对象字段', () => {
    const a = mkAnalysis();
    expect(() => applyFillPatches(a, [{ path: 'facts', value: 'xxx' }])).toThrow(/不匹配/);
  });

  it('任一路径非法 → 抛错且不产生部分写入', () => {
    const a = mkAnalysis();
    expect(() =>
      applyFillPatches(a, [
        { path: 'parties.被告.name', value: '李四' },
        { path: 'no_such_field', value: 'x' },
      ]),
    ).toThrow();
    expect(a.parties.被告.name).toBe(''); // 两遍式: 校验失败时一条都不改
  });
});

describe('fillAnalysisCommand (落盘)', () => {
  it('原地写回 + _fillLog 追加; --out 不碰原文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fill-'));
    try {
      const file = join(dir, 'analysis.json');
      writeFileSync(file, JSON.stringify(mkAnalysis(), null, 2), 'utf-8');

      await fillAnalysisCommand(file, { set: ['parties.被告.name=李四'] });
      const reread = JSON.parse(readFileSync(file, 'utf-8')) as ComplaintAnalysis;
      expect(reread.parties.被告.name).toBe('李四');
      expect(reread._fillLog?.length).toBe(1);
      expect(reread._fillLog?.[0]?.path).toBe('parties.被告.name');
      expect(reread._fillLog?.[0]?.previous).toBe('');

      // 再回填一次 → 审计日志累计不覆盖
      await fillAnalysisCommand(file, { set: ['facts.spread=阅读量10万'], allowNew: false });
      const again = JSON.parse(readFileSync(file, 'utf-8')) as ComplaintAnalysis;
      expect(again._fillLog?.length).toBe(2);
      expect(again._fillLog?.[1]?.path).toBe('facts.spread');

      // --out 另存: 原文件不动
      const outPath = join(dir, 'analysis-v2.json');
      await fillAnalysisCommand(file, { set: ['parties.原告.name=王五'], out: outPath });
      const original = JSON.parse(readFileSync(file, 'utf-8')) as ComplaintAnalysis;
      expect(original.parties.原告.name).toBe('张三');
      const saved = JSON.parse(readFileSync(outPath, 'utf-8')) as ComplaintAnalysis;
      expect(saved.parties.原告.name).toBe('王五');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
