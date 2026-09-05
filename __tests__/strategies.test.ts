/**
 * 反驳策略库 — 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  STRATEGIES,
  selectStrategies,
  selectStrategyForClaim,
} from '../src/rebuttal/strategies';
import type { ComplaintAnalysis } from '../src/analyzer/complaint-types';

function mkAnalysis(overrides: Partial<ComplaintAnalysis> = {}): ComplaintAnalysis {
  return {
    source: 'test',
    analyzedAt: '2025-01-01',
    mode: 'draft',
    parties: {
      原告: { name: '张三', role: '原告' },
      被告: { name: '李四', role: '被告' },
    },
    cause: '网络侵权名誉权',
    claims: [
      { index: 1, content: '停止侵害', type: 'stop_infringement' },
      { index: 2, content: '赔礼道歉', type: 'restore_reputation' },
      { index: 3, content: '赔偿合理费用 30000 元', type: 'compensate_loss', amount: 30000 },
      { index: 4, content: '精神损害抚慰金 50000 元', type: 'spiritual_compensation', amount: 50000 },
    ],
    facts: { tortMethod: '微博', tortContent: '测试内容', spread: '' },
    evidence: [],
    legalBasis: ['民法典第 1024 条'],
    elementScore: { factAuthenticity: 'unknown', directedness: 'medium', fault: 'unknown', damage: 'weak' },
    rebuttalPriority: [1, 2, 3, 4],
    confidence: 0.5,
    warnings: [],
    ...overrides,
  };
}

describe('STRATEGIES 库完整性', () => {
  it('5 个反点齐备', () => {
    expect(Object.keys(STRATEGIES)).toEqual(
      expect.arrayContaining(['fact-true', 'no-act', 'no-tort-grade', 'no-damage', 'no-causation']),
    );
  });

  it('每个策略必填字段完整', () => {
    for (const s of Object.values(STRATEGIES)) {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.template.length).toBeGreaterThan(50);
      expect(s.legalBasis).toBeTruthy();
      expect(s.evidenceToGather.length).toBeGreaterThanOrEqual(1);
      expect(s.caseRefs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('类案参考要点式, 无具体案号', () => {
    for (const s of Object.values(STRATEGIES)) {
      for (const ref of s.caseRefs) {
        expect(ref.title).toBeTruthy();
        expect(ref.holding).toBeTruthy();
        expect(ref.applicableWhen).toBeTruthy();
        // 不应包含 "案号" "（20xx）" 等具体标识
        expect(ref.title).not.toMatch(/（\d{4}）|\d{4}年/);
      }
    }
  });
});

describe('selectStrategies', () => {
  it('事实 likely_true 时优先 fact-true', () => {
    const a = mkAnalysis({ elementScore: { ...mkAnalysis().elementScore, factAuthenticity: 'likely_true' } });
    const picked = selectStrategies(a, 3);
    expect(picked[0]?.id).toBe('fact-true');
  });

  it('指向性 low 时优先 no-tort-grade', () => {
    const a = mkAnalysis({ elementScore: { ...mkAnalysis().elementScore, directedness: 'low' } });
    const picked = selectStrategies(a, 3);
    expect(picked[0]?.id).toBe('no-tort-grade');
  });

  it('损害 none_proven 时优先 no-damage', () => {
    const a = mkAnalysis({ elementScore: { ...mkAnalysis().elementScore, damage: 'none_proven' } });
    const picked = selectStrategies(a, 3);
    expect(picked[0]?.id).toBe('no-damage');
  });

  it('兜底: 适用度全 0 时仍返回至少 1 个', () => {
    const a = mkAnalysis();
    // 强制造一个所有适用度都低的情况
    a.elementScore.factAuthenticity = 'unknown';
    a.elementScore.directedness = 'medium';
    a.elementScore.damage = 'strong';
    const picked = selectStrategies(a, 3);
    expect(picked.length).toBeGreaterThanOrEqual(1);
  });

  it('topN 限制返回数量', () => {
    const a = mkAnalysis();
    const picked = selectStrategies(a, 2);
    expect(picked.length).toBeLessThanOrEqual(2);
  });
});

describe('selectStrategyForClaim', () => {
  it('停止侵害类诉请 → 优先 no-act / no-tort-grade / fact-true', () => {
    const a = mkAnalysis();
    const s = selectStrategyForClaim(a.claims[0]!, a);
    expect(['no-act', 'no-tort-grade', 'fact-true']).toContain(s.id);
  });

  it('精神损害赔偿 → 优先 no-damage / no-causation', () => {
    const a = mkAnalysis();
    const s = selectStrategyForClaim(a.claims[3]!, a);
    expect(['no-damage', 'no-causation']).toContain(s.id);
  });

  it('诉请金额越大, 越倾向 no-damage', () => {
    const a = mkAnalysis({
      elementScore: { ...mkAnalysis().elementScore, damage: 'none_proven' },
    });
    const s = selectStrategyForClaim(a.claims[3]!, a); // 50000 元精神损害
    expect(s.id).toBe('no-damage');
  });
});
