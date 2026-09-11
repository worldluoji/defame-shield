/**
 * apply-fixes 单元测试
 */
import { describe, it, expect } from 'vitest';
import { applyFixes, type Vulnerability } from '../src/rebuttal/self-check';
import type { ComplaintAnalysis } from '../src/analyzer/complaint-types';

const sampleAnalysis: ComplaintAnalysis = {
  source: 'test',
  analyzedAt: '2025-01-01',
  mode: 'draft',
  parties: { 原告: { name: '张三', role: '原告' }, 被告: { name: '李四', role: '被告' } },
  cause: '网络侵权名誉权',
  claims: [
    { index: 1, content: '停止侵害', type: 'stop_infringement' },
    { index: 2, content: '赔礼道歉', type: 'restore_reputation' },
  ],
  facts: { tortMethod: '微博', tortContent: '内容', spread: '' },
  evidence: [],
  legalBasis: ['民法典 1024'],
  legalBasisItems: [{ raw: '民法典 1024', category: '民法典', article: '1024' }],
  elementScore: { factAuthenticity: 'unknown', directedness: 'medium', fault: 'unknown', damage: 'weak' },
  rebuttalPriority: [1, 2],
  confidence: 0.3,
  warnings: [],
};

function mkVuln(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: 'unfilled-placeholders',
    attack: '占位符未填',
    risk: 'critical',
    strategyId: 'no-damage',
    plaintiffArgument: '占位符过多, 法院不应采信',
    suggestedFix: '逐一填充所有 [待补充] 占位符',
    ...overrides,
  };
}

describe('applyFixes', () => {
  it('注入占位符提醒段', () => {
    const defense = '## ⚠️ 重要提示\n这是提示';
    const result = applyFixes(defense, [mkVuln()], sampleAnalysis, {
      caseName: '测试',
      defendantName: '李四',
    });
    expect(result.injectedCount).toBe(1);
    expect(result.patched).toContain('📌 待补充占位符清单');
    expect(result.patched).toContain('逐一填充所有 [待补充]');
  });

  it('注入程序性反点 (missing-statute-limitations)', () => {
    const defense = '## 总体答辩策略\n这是策略';
    const vuln = mkVuln({ id: 'missing-statute-limitations', strategyId: 'statute-limitations', risk: 'critical' });
    // 时效注入的前提: 拆解结果能确认侵权-起诉间隔确超 3 年
    const analysis: ComplaintAnalysis = {
      ...sampleAnalysis,
      facts: { ...sampleAnalysis.facts, time: '2021 年 3 月' },
      filingDate: '2025-06-01',
    };
    const result = applyFixes(defense, [vuln], analysis, {
      caseName: '测试',
      defendantName: '李四',
    });
    expect(result.injectedCount).toBe(1);
    expect(result.patched).toContain('超过诉讼时效');
  });

  it('无时效数据时拒绝注入时效断言 (漏洞可能来自 AI, 不可信)', () => {
    const defense = '## 总体答辩策略\n这是策略';
    const vuln = mkVuln({ id: 'missing-statute-limitations', strategyId: 'statute-limitations', risk: 'critical' });
    // sampleAnalysis 无 facts.time / filingDate → 不得注入
    const result = applyFixes(defense, [vuln], sampleAnalysis, {
      caseName: '测试',
      defendantName: '李四',
    });
    expect(result.injectedCount).toBe(0);
    expect(result.patched).not.toContain('超过诉讼时效');
    expect(result.summary).toContain('跳过 missing-statute-limitations');
  });

  it('missing-jurisdiction: 即便线索明确也拒注入 (适用度上限 0.5 < 0.6, 宁缺毋滥)', () => {
    const defense = '## 总体答辩策略\n这是策略';
    const vuln = mkVuln({ id: 'missing-jurisdiction', strategyId: 'jurisdiction', risk: 'critical' });
    const analysis: ComplaintAnalysis = {
      ...sampleAnalysis,
      facts: { ...sampleAnalysis.facts, place: '北京市' },
      parties: {
        原告: { name: '张三', role: '原告' },
        被告: { name: '李四', role: '被告', address: '上海市黄浦区某某路 100 号' },
      },
    };
    const result = applyFixes(defense, [vuln], analysis, {
      caseName: '测试',
      defendantName: '李四',
    });
    expect(result.injectedCount).toBe(0);
    expect(result.patched).not.toContain('无管辖权');
    expect(result.summary).toContain('跳过 missing-jurisdiction');
  });

  it('missing-wrong-party: 平台线索 (0.6) 确证时仍可注入', () => {
    const defense = '## 总体答辩策略\n这是策略';
    const vuln = mkVuln({ id: 'missing-wrong-party', strategyId: 'wrong-party', risk: 'critical' });
    const analysis: ComplaintAnalysis = {
      ...sampleAnalysis,
      facts: { ...sampleAnalysis.facts, tortMethod: '某网站' },
    };
    const result = applyFixes(defense, [vuln], analysis, {
      caseName: '测试',
      defendantName: '李四',
    });
    expect(result.injectedCount).toBe(1);
    expect(result.patched).toContain('被告主体不适格');
  });

  it('低风险漏洞不注入', () => {
    const defense = '## 重要提示';
    const vuln = mkVuln({ id: 'low-risk-id', risk: 'low' });
    const result = applyFixes(defense, [vuln], sampleAnalysis, {
      caseName: '测试',
      defendantName: '李四',
    });
    expect(result.injectedCount).toBe(0);
  });

  it('多个漏洞全部注入', () => {
    const defense = '## 总体答辩策略\n## ⚠️ 重要提示';
    const vulns = [
      mkVuln({ id: 'unfilled-placeholders' }),
      mkVuln({ id: 'no-evidence-guidance' }), // 跳过 (在 else-if 里)
      mkVuln({ id: 'claim-2-no-response', claimIndex: 2, risk: 'high' }),
    ];
    const result = applyFixes(defense, vulns, sampleAnalysis, {
      caseName: '测试',
      defendantName: '李四',
    });
    expect(result.injectedCount).toBeGreaterThanOrEqual(2);
  });

  it('空漏洞列表返回原文 + summary=无需修补', () => {
    const defense = '原文';
    const result = applyFixes(defense, [], sampleAnalysis, {
      caseName: '测试',
      defendantName: '李四',
    });
    expect(result.injectedCount).toBe(0);
    expect(result.summary).toBe('无需修补');
  });
});
