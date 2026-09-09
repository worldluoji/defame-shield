/**
 * 答辩状生成器 (v2) 集成测试
 */
import { describe, it, expect } from 'vitest';
import { generateDefense } from '../src/generators/defense';
import { analyzeComplaint } from '../src/analyzer/complaint-parser';
import type { Case } from '../src/case/types';

const SAMPLE_COMPLAINT = `# 民事起诉状

## 原告

- **姓名/名称**：张三
- **身份证号**：110101199001011234
- **住所地**：北京市东城区某某路 1 号

## 被告

- **姓名/名称**：李四
- **住所地**：上海市黄浦区某某路 100 号

## 案由

网络侵权名誉权

## 诉讼请求

1. 依法判令被告立即停止对原告名誉权的侵害 (删除所有侵权微博);
2. 依法判令被告在微博平台公开向原告赔礼道歉、消除影响、恢复名誉;
3. 依法判令被告赔偿原告因维权所支出的合理费用合计人民币 30000 元;
4. 依法判令被告赔偿原告精神损害抚慰金人民币 50000 元;
5. 依法判令被告承担本案全部诉讼费。

## 事实与理由

被告通过微博账号 @李四微博 发布侵权内容为"张三是个骗子"等。

## 法律依据

1. 《中华人民共和国民法典》第一千零二十四条；
2. 《中华人民共和国民法典》第一千零二十五条。

此致

北京市东城区人民法院
`;

const SAMPLE_CASE: Case = {
  id: 'def-001',
  title: '被告视角测试案件',
  cause: '网络侵权名誉权',
  plaintiff: { name: '张三', role: '原告' },
  defendant: { name: '李四', role: '被告', address: '上海市黄浦区某某路 100 号' },
  facts: '测试',
  claims: [],
  evidence: [],
  court: '北京市东城区人民法院',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

describe('generateDefense (draft 模式)', () => {
  it('自动选择 1-3 个最适反点', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: SAMPLE_CASE,
      draft: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.strategies.length).toBeGreaterThanOrEqual(1);
    expect(r.strategies.length).toBeLessThanOrEqual(3);
  });

  it('逐条诉请都生成对应反驳段落', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: SAMPLE_CASE,
      draft: true,
    });
    if (!r.ok) throw new Error('gen fail');
    // 5 条诉请, 每条都有 "诉请 X: ..."
    for (let i = 1; i <= a.analysis.claims.length; i++) {
      expect(r.content).toContain(`诉请 ${i}`);
    }
  });

  it('包含类案参考', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: SAMPLE_CASE,
      draft: true,
    });
    if (!r.ok) throw new Error('gen fail');
    expect(r.caseRefs.length).toBeGreaterThanOrEqual(1);
    expect(r.content).toContain('类案参考');
  });

  it('包含证据指引', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: SAMPLE_CASE,
      draft: true,
    });
    if (!r.ok) throw new Error('gen fail');
    expect(r.content).toContain('答辩证据指引');
  });

  it('包含总体答辩策略', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: SAMPLE_CASE,
      draft: true,
    });
    if (!r.ok) throw new Error('gen fail');
    expect(r.content).toContain('总体答辩策略');
  });

  it('被告姓名正确填入', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: SAMPLE_CASE,
      draft: true,
    });
    if (!r.ok) throw new Error('gen fail');
    expect(r.content).toContain('李四');
  });

  it('类案参考使用要点式, 不编造案号', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: SAMPLE_CASE,
      draft: true,
    });
    if (!r.ok) throw new Error('gen fail');
    // 不应包含案号格式
    expect(r.content).not.toMatch(/（\d{4}）/);
  });

  it('保留待补充标记', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: SAMPLE_CASE,
      draft: true,
    });
    if (!r.ok) throw new Error('gen fail');
    expect(r.content).toContain('待补充');
  });
});

describe('generateDefense (AI 模式失败回退)', () => {
  it('LLM 不可用时返回 draft fallback', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    process.env.MODEL_PROVIDER = 'deepseek';

    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: SAMPLE_CASE,
      draft: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.draftFallback).toBeDefined();
    expect(r.draftFallback).toContain('总体答辩策略');
  });
});
