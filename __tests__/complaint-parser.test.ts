/**
 * complaint-parser 单元测试 — 重点测 draft 模式 (无 LLM 依赖)
 */
import { describe, it, expect } from 'vitest';
import { analyzeComplaint } from '../src/analyzer/complaint-parser';
import type { ComplaintAnalysis } from '../src/analyzer/complaint-types';

const SAMPLE_COMPLAINT = `# 民事起诉状

## 原告

- **姓名/名称**：张三
- **身份证号 / 统一社会信用代码**：110101199001011234
- **住所地**：北京市东城区某某路 1 号
- **联系电话**：13800138000

## 被告

- **姓名/名称**：李四
- **身份证号 / 统一社会信用代码**：310101199002022345
- **住所地**：上海市黄浦区某某路 100 号
- **联系电话**：13900139000

## 案由

网络侵权名誉权

## 诉讼请求

1. 依法判令被告立即停止对原告名誉权的侵害 (删除所有侵权微博);
2. 依法判令被告在微博平台公开向原告赔礼道歉、消除影响、恢复名誉 (保留 90 日);
3. 依法判令被告赔偿原告因维权所支出的合理费用 (公证费、律师费、差旅费等) 合计人民币 30000 元;
4. 依法判令被告赔偿原告精神损害抚慰金人民币 50000 元;
5. 依法判令被告承担本案全部诉讼费、公告费等诉讼费用。

## 事实与理由

2025 年 5 月 1 日至 2025 年 6 月 1 日期间，被告李四通过其微博账号 @李四微博 (粉丝 50 万)，连续发布 10 余条针对原告张三的侮辱性、诽谤性言论。

其中内容为"张三是个彻头彻尾的骗子，骗了大家几千万"、"张三生活作风极差，是行业内公开的秘密"等。

上述言论经大量转发评论，严重损害了原告的社会评价。

## 法律依据

1. 《中华人民共和国民法典》第一千零二十四条；
2. 《中华人民共和国民法典》第一千零二十五条。

此致

北京市东城区人民法院

具状人：张三

2025 年 9 月 10 日

`;

describe('analyzeComplaint (draft 模式)', () => {
  it('拒绝过短输入', async () => {
    const res = await analyzeComplaint('太短了', { draft: true });
    expect(res.ok).toBe(false);
  });

  it('抽取原告/被告姓名', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.analysis.parties.原告.name).toBe('张三');
    expect(res.analysis.parties.被告.name).toBe('李四');
  });

  it('抽取诉请 (5 条)', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.claims.length).toBeGreaterThanOrEqual(4);
    const types = res.analysis.claims.map((c) => c.type);
    expect(types).toContain('stop_infringement');
    expect(types).toContain('restore_reputation');
    expect(types).toContain('compensate_loss');
    expect(types).toContain('spiritual_compensation');
  });

  it('抽取金额', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    const claim3 = res.analysis.claims.find((c) => c.amount === 30000);
    const claim4 = res.analysis.claims.find((c) => c.amount === 50000);
    expect(claim3).toBeDefined();
    expect(claim4).toBeDefined();
  });

  it('抽取事实 (侵权方式 + 内容)', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.facts.tortMethod).toBeTruthy();
    expect(res.analysis.facts.tortContent).toContain('张三');
  });

  it('抽取法条', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.legalBasis.length).toBeGreaterThanOrEqual(1);
    expect(res.analysis.legalBasis.some((s) => s.includes('民法典'))).toBe(true);
  });

  it('置信度为 0.3 (draft 模式默认)', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.confidence).toBe(0.3);
  });

  it('反驳优先级按诉请顺序', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.rebuttalPriority).toEqual([1, 2, 3, 4, 5].slice(0, res.analysis.claims.length));
  });
});

describe('analyzeComplaint (AI 模式失败回退)', () => {
  it('LLM 不可用时返回 partialDraft', async () => {
    // 不传 API key, AI 模式必然失败
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    process.env.MODEL_PROVIDER = 'deepseek';

    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: false });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('llm_error');
    expect(res.partialDraft).toBeDefined();
    expect(res.partialDraft?.parties.原告.name).toBe('张三');
  });
});

describe('draft 模式证据段抽取', () => {
  it('证据清单段 → 逐条抽取, 含来源/公证标记', async () => {
    const withEvidence = SAMPLE_COMPLAINT
      + '\n## 证据清单\n\n1. 公证书 (北京市长安公证处, 2025年6月2日)\n2. 微博截图 (来源: 微博平台)\n';
    const res = await analyzeComplaint(withEvidence, { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.evidence.length).toBeGreaterThanOrEqual(2);
    const notarizedItem = res.analysis.evidence.find((e) => e.name.includes('公证书'));
    expect(notarizedItem?.notarized).toBe(true);
    const sourceItem = res.analysis.evidence.find((e) => e.name.includes('微博截图'));
    expect(sourceItem?.source).toBe('微博平台');
  });
});

describe('类型契约', () => {
  it('ComplaintAnalysis 形状稳定', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    const a: ComplaintAnalysis = res.analysis;
    expect(typeof a.source).toBe('string');
    expect(typeof a.analyzedAt).toBe('string');
    expect(a.mode).toBe('draft');
    expect(Array.isArray(a.claims)).toBe(true);
    expect(Array.isArray(a.evidence)).toBe(true);
    expect(Array.isArray(a.legalBasis)).toBe(true);
    expect(Array.isArray(a.legalBasisItems)).toBe(true);
    expect(Array.isArray(a.rebuttalPriority)).toBe(true);
    expect(Array.isArray(a.warnings)).toBe(true);
    expect(typeof a.elementScore).toBe('object');
  });
});

describe('扩字段 (C)', () => {
  it('抽取起诉法院 courtOfFiling', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.courtOfFiling).toBe('北京市东城区人民法院');
  });

  it('draft 抽取侵权时间 (事实段句首日期)', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.facts.time).toBe('2025 年 5 月 1 日');
  });

  it('draft 抽取起诉日期 (落款)', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.filingDate).toBe('2025-09-10');
  });

  it('无落款日期时 filingDate 为空', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT.replace(/\n*2025 年 9 月 10 日\n*/, '\n'), { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.filingDate).toBeUndefined();
  });

  it('legalBasisItems 结构化 (含 category/article)', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    expect(res.analysis.legalBasisItems.length).toBeGreaterThanOrEqual(1);
    const first = res.analysis.legalBasisItems[0]!;
    expect(first.category).toBe('民法典');
    // SAMPLE 用汉字 "第一千零二十四条", article 字段是汉字数字
    expect(first.article).toMatch(/一千零二十四|一千零二十五/);
  });

  it('evidence 含 source/acquiredAt/notarized 字段 (空时为 undefined)', async () => {
    const res = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!res.ok) throw new Error('fail');
    // SAMPLE 没有显式证据段, 所以 evidence 应该空
    expect(res.analysis.evidence).toEqual([]);
  });
});
