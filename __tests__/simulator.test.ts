/**
 * 攻防推演 + 法条版本检查 测试
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../src/rebuttal/simulator';
import { checkAllStatutes, checkStatute, STATUTE_REGISTRY } from '../src/data/statutes';
import type { ComplaintAnalysis } from '../src/analyzer/complaint-types';
import type { Case } from '../src/case/types';

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
  legalBasisItems: [{ raw: '《中华人民共和国民法典》第一千零二十四条', category: '民法典', article: '1024' }],
  elementScore: { factAuthenticity: 'unknown', directedness: 'medium', fault: 'unknown', damage: 'weak' },
  rebuttalPriority: [1, 2],
  confidence: 0.3,
  warnings: [],
};

const sampleCase: Case = {
  id: 'def-001',
  title: '测试',
  cause: '网络侵权名誉权',
  plaintiff: { name: '张三', role: '原告' },
  defendant: { name: '李四', role: '被告' },
  facts: '',
  claims: [],
  evidence: [],
  court: '北京',
  createdAt: '',
  updatedAt: '',
};

describe('simulateBattle (rule 模式)', () => {
  it('基础推演 3 轮', async () => {
    const defense = '## 总体答辩策略\n被告答辩...';
    const r = await simulateBattle({
      case: sampleCase,
      analysis: sampleAnalysis,
      defense,
      rounds: 3,
    });
    expect(r.ok).toBe(true);
    expect(r.rounds.length).toBe(3 + 1); // Round 0 + 3
    expect(r.trajectory.length).toBe(4);
  });

  it('Round 0 = 起诉状, Round 1 = 答辩状', async () => {
    const r = await simulateBattle({
      case: sampleCase,
      analysis: sampleAnalysis,
      defense: '## 总体答辩策略\n被告答辩',
    });
    expect(r.rounds[0]?.type).toBe('起诉状');
    expect(r.rounds[1]?.type).toBe('答辩状');
    expect(r.rounds[1]?.side).toBe('被告');
    expect(r.rounds[2]?.side).toBe('原告'); // 反驱
  });

  it('含程序性反点的答辩状评分高', async () => {
    const goodDefense = `## 总体答辩策略
本案已超过三年诉讼时效, 依据民法典 188 条, 被告在此明确提出时效抗辩.
被告主体不适格, 涉案账号非被告所有.

## 事实与理由
被告的微博内容有合理信息来源, 已尽到合理核实义务, 属于舆论监督的免责情形.
涉案内容并未指名道姓, 公众无法识别原告属于特定主体, 不构成名誉权侵害.
原告未能举证证明实际损害, 该项请求不应得到支持.

## 类案参考
裁判要点: 舆论监督涉及产品质量的批评, 内容基本属实的, 不应认定为侵害名誉权.

## 答辩证据指引
- 信息来源原始材料
- 平台注册信息
`;
    const r = await simulateBattle({
      case: sampleCase,
      analysis: sampleAnalysis,
      defense: goodDefense,
    });
    expect(r.rounds[1]?.defendantWinProb).toBeGreaterThanOrEqual(75);
  });

  it('含很多占位符的答辩状评分低', async () => {
    const badDefense = `## 总体答辩策略
[待补充: ...] [待补充: ...] [待补充: ...] [待补充: ...]
[账号 ID] [来源] [核实] [平台]`;
    const r = await simulateBattle({
      case: sampleCase,
      analysis: sampleAnalysis,
      defense: badDefense,
    });
    expect(r.rounds[1]?.defendantWinProb).toBeLessThan(60);
  });

  it('trend = improving/worsening/stable', async () => {
    const r = await simulateBattle({
      case: sampleCase,
      analysis: sampleAnalysis,
      defense: '## 答辩',
      rounds: 3,
    });
    expect(['improving', 'stable', 'worsening']).toContain(r.trend);
  });

  it('整体建议非空', async () => {
    const r = await simulateBattle({
      case: sampleCase,
      analysis: sampleAnalysis,
      defense: '## 答辩',
    });
    expect(r.overallAdvice.length).toBeGreaterThan(10);
  });
});

describe('法条版本检查', () => {
  it('checkStatute: 民法典 1024 found', () => {
    const r = checkStatute({ raw: '《民法典》1024', category: '民法典', article: '1024' });
    expect(r.status).toBe('found');
    expect(r.id).toBe('民法典-1024');
    expect(r.text).toContain('名誉权');
  });

  it('checkStatute: 未知法条 not_found', () => {
    const r = checkStatute({ raw: '《某法》第1条', category: '其他', article: '1' });
    expect(r.status).toBe('not_found');
  });

  it('checkStatute: 民诉法-67 found', () => {
    const r = checkStatute({ raw: '《民诉法》第六十七条', category: '民诉法', article: '67' });
    expect(r.status).toBe('found');
    expect(r.relatedInterpretations).toBeDefined();
  });

  it('checkAllStatutes 批量', () => {
    const items = [
      { raw: '民法典 1024', category: '民法典' as const, article: '1024' },
      { raw: '民法典 1025', category: '民法典' as const, article: '1025' },
      { raw: '某法 第1条', category: '其他' as const, article: '1' },
    ];
    const results = checkAllStatutes(items);
    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe('found');
    expect(results[2]?.status).toBe('not_found');
  });

  it('内置登记 ≥ 6 个核心法条', () => {
    expect(STATUTE_REGISTRY.length).toBeGreaterThanOrEqual(6);
  });

  it('每个登记条 lastReviewed 是 ISO', () => {
    for (const s of STATUTE_REGISTRY) {
      expect(s.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
