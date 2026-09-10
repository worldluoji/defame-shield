/**
 * mergeAnalysisIntoCase — 起诉状拆解回填案件 (纯函数) 单元测试
 */
import { describe, it, expect } from 'vitest';
import { mergeAnalysisIntoCase } from '../src/case/case';
import type { Case } from '../src/case/types';
import type { ComplaintAnalysis } from '../src/analyzer/complaint-types';

function mkCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 'c1',
    title: '测试案件',
    cause: '网络侵权名誉权',
    plaintiff: { name: '[待补充: 由起诉状拆解回填]', role: '原告' },
    defendant: { name: '赵某', role: '被告' },
    facts: '',
    claims: [],
    evidence: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function mkAnalysis(overrides: Partial<ComplaintAnalysis> = {}): ComplaintAnalysis {
  return {
    source: 'test',
    analyzedAt: '2026-01-01',
    mode: 'draft',
    parties: {
      原告: { name: '王女士', role: '原告', address: '北京市海淀区某路 1 号', contact: '138' },
      被告: { name: '赵某', role: '被告', address: '上海市黄浦区某路 2 号' },
    },
    cause: '网络侵权名誉权',
    claims: [
      { index: 1, content: '停止侵害', type: 'stop_infringement' },
      { index: 2, content: '赔偿 50000 元', type: 'spiritual_compensation', amount: 50000 },
    ],
    facts: { tortMethod: '微博', tortContent: '骗子', spread: '粉丝 80', time: '2025 年 3 月' },
    evidence: [],
    legalBasis: [],
    legalBasisItems: [],
    elementScore: { factAuthenticity: 'unknown', directedness: 'medium', fault: 'unknown', damage: 'weak' },
    rebuttalPriority: [1, 2],
    confidence: 0.3,
    warnings: [],
    ...overrides,
  };
}

describe('mergeAnalysisIntoCase', () => {
  it('原告信息从拆解结果回填 (覆盖占位符)', () => {
    const m = mergeAnalysisIntoCase(mkCase(), mkAnalysis());
    expect(m.plaintiff.name).toBe('王女士');
    expect(m.plaintiff.address).toBe('北京市海淀区某路 1 号');
    expect(m.plaintiff.contact).toBe('138');
  });

  it('诉请被起诉状权威覆盖', () => {
    const m = mergeAnalysisIntoCase(mkCase(), mkAnalysis());
    expect(m.claims).toHaveLength(2);
    expect(m.claims[1]!.amount).toBe(50000);
  });

  it('拆解无诉请时保留原 claims', () => {
    const base = mkCase({ claims: [{ content: '手工填写' }] });
    const m = mergeAnalysisIntoCase(base, mkAnalysis({ claims: [] }));
    expect(m.claims).toEqual([{ content: '手工填写' }]);
  });

  it('被告以人工填写为准, 仅补齐空缺字段', () => {
    const m = mergeAnalysisIntoCase(mkCase(), mkAnalysis());
    expect(m.defendant.name).toBe('赵某');
    expect(m.defendant.address).toBe('上海市黄浦区某路 2 号'); // 原本为空 → 补齐
  });

  it('法院: 空则取起诉法院, 已填则保留', () => {
    const filled = mergeAnalysisIntoCase(mkCase(), mkAnalysis({ courtOfFiling: '北京市海淀区人民法院' }));
    expect(filled.court).toBe('北京市海淀区人民法院');
    const manual = mergeAnalysisIntoCase(mkCase({ court: '上海法院' }), mkAnalysis({ courtOfFiling: '北京法院' }));
    expect(manual.court).toBe('上海法院');
  });

  it('facts: 空时由侵权时间/方式/内容拼摘要, 已填则不动', () => {
    const m = mergeAnalysisIntoCase(mkCase(), mkAnalysis());
    expect(m.facts).toContain('2025 年 3 月');
    expect(m.facts).toContain('微博');
    const manual = mergeAnalysisIntoCase(mkCase({ facts: '人工摘要' }), mkAnalysis());
    expect(manual.facts).toBe('人工摘要');
  });

  it('律师缺失时用拆解结果中的代理律师', () => {
    const m = mergeAnalysisIntoCase(mkCase(), mkAnalysis({
      parties: {
        原告: { name: '王女士', role: '原告' },
        被告: { name: '赵某', role: '被告' },
        律师: { name: '某律师', role: '律师' },
      },
    }));
    expect(m.lawyer?.name).toBe('某律师');
  });
});
