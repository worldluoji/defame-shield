/**
 * 答辩状生成器 (v2) 集成测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDefense } from '../src/generators/defense';
import { analyzeComplaint } from '../src/analyzer/complaint-parser';
import { callLLM } from '../src/llm/client';
import type { Case } from '../src/case/types';

vi.mock('../src/llm/client', () => ({
  callLLM: vi.fn(),
  AI_MODELS: {
    deepseek: { maxOutputTokens: 8192 },
    minimax: { maxOutputTokens: 16384 },
  },
  resolveProvider: (p?: string) => p ?? 'deepseek',
}));

function llmOk(text: string) {
  return { ok: true as const, text, provider: 'deepseek' as const, model: 'mock', elapsedMs: 1 };
}

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

  it('起诉状无明确侵权时间 → 答辩状不含 "超过诉讼时效" 断言', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({ analysis: a.analysis, case: SAMPLE_CASE, draft: true });
    if (!r.ok) throw new Error('gen fail');
    expect(r.content).not.toContain('超过诉讼时效');
    expect(r.strategies.some((s) => s.id === 'statute-limitations')).toBe(false);
  });

  it('侵权 4 年前 + 落款起诉日期 → 时效反点触发且填入真实时间', async () => {
    const oldComplaint = SAMPLE_COMPLAINT
      .replace(
        '被告通过微博账号 @李四微博 发布侵权内容为"张三是个骗子"等。',
        '2021 年 3 月 15 日, 被告通过微博账号 @李四微博 发布侵权内容为"张三是个骗子"等。',
      )
      .replace('北京市东城区人民法院\n', '北京市东城区人民法院\n\n具状人：张三\n\n2025 年 9 月 10 日\n');
    const a = await analyzeComplaint(oldComplaint, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({ analysis: a.analysis, case: SAMPLE_CASE, draft: true });
    if (!r.ok) throw new Error('gen fail');
    expect(r.content).toContain('超过诉讼时效');
    expect(r.content).toContain('2025-09-10');
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

  it('被告陈述 (defendantFacts) 写入"答辩人的事实主张"节', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: { ...SAMPLE_CASE, defendantFacts: '涉案内容为正常消费评价, 与原告无恩怨。' },
      draft: true,
    });
    if (!r.ok) throw new Error('gen fail');
    expect(r.content).toContain('涉案内容为正常消费评价, 与原告无恩怨。');
    expect(r.content).not.toContain('[待补充: 答辩人需要在此节陈述');
  });

  it('被告陈述为空 → 保留 [待补充] 占位且不虚构', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: { ...SAMPLE_CASE, defendantFacts: '   ' },
      draft: true,
    });
    if (!r.ok) throw new Error('gen fail');
    expect(r.content).toContain('[待补充: 答辩人需要在此节陈述');
    expect(r.content).toContain('dsh case set def-001 defendantFacts');
  });

  it('case.evidence 合入答辩证据指引"答辩人已掌握证据"', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: {
        ...SAMPLE_CASE,
        evidence: [
          { index: 1, name: '订单截图', kind: '电子数据', purpose: '证明评价基于真实消费', source: '平台后台' },
        ],
      },
      draft: true,
    });
    if (!r.ok) throw new Error('gen fail');
    expect(r.content).toContain('答辩人已掌握证据');
    expect(r.content).toContain('订单截图');
    expect(r.content).toContain('证明评价基于真实消费');
    expect(r.content).toContain('平台后台');
  });
});

describe('generateDefense (AI 模式失败回退)', () => {
  beforeEach(() => {
    vi.mocked(callLLM).mockReset();
  });

  it('LLM 不可用时返回 draft fallback', async () => {
    vi.mocked(callLLM).mockResolvedValue({ ok: false, code: 'missing_key', error: 'Missing API key' });

    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const r = await generateDefense({
      analysis: a.analysis,
      case: SAMPLE_CASE,
      draft: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('missing_key');
    expect(r.draftFallback).toBeDefined();
    expect(r.draftFallback).toContain('总体答辩策略');
  });
});

describe('generateDefense (AI 润色截断处理)', () => {
  beforeEach(() => {
    vi.mocked(callLLM).mockReset();
  });

  async function analysis() {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    return a.analysis;
  }

  const FULL_BODY = [
    '# 民事答辩状',
    '## 对各项诉讼请求的答辩',
    '诉请 1 ...',
    '## 类案参考（裁判要点）',
    '## 答辩证据指引',
    '此致',
    '答辩人：李四',
  ].join('\n');

  it('正文完整但缺免责声明尾部 → 从 draft 拼装, 不再调 LLM', async () => {
    vi.mocked(callLLM).mockResolvedValue(llmOk(FULL_BODY));
    const r = await generateDefense({ analysis: await analysis(), case: SAMPLE_CASE, draft: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('## ⚠️ 重要提示');
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('真截断 → 自动续写, 拼上尾段后采纳', async () => {
    const partial = '# 民事答辩状\n\n## 对各项诉讼请求的答辩\n\n诉请 1 驳';
    vi.mocked(callLLM)
      .mockResolvedValueOnce(llmOk(partial))
      .mockResolvedValueOnce(llmOk('回。\n\n## 类案参考\n\n## 答辩证据指引\n\n此致\n\n## ⚠️ 重要提示\n\n1. 本答辩状系自动生成初稿'));
    const r = await generateDefense({ analysis: await analysis(), case: SAMPLE_CASE, draft: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain('## ⚠️ 重要提示');
    expect(callLLM).toHaveBeenCalledTimes(2);
    // 续写请求把已输出内容作为 assistant 消息回喂
    const contMsgs = vi.mocked(callLLM).mock.calls[1]![0];
    expect(contMsgs.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('续写 2 次仍截断 → 拒绝采纳, 附 draft fallback', async () => {
    vi.mocked(callLLM).mockResolvedValue(llmOk('# 民事答辩状\n\n## 对各项诉讼请求的答辩\n\n诉请 1 驳'));
    const r = await generateDefense({ analysis: await analysis(), case: SAMPLE_CASE, draft: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('续写 2 次');
    expect(r.draftFallback).toContain('总体答辩策略');
    expect(callLLM).toHaveBeenCalledTimes(3); // 1 初稿 + 2 续写
  });

  it('续写调用失败 → 拒绝采纳并说明原因', async () => {
    vi.mocked(callLLM)
      .mockResolvedValueOnce(llmOk('# 民事答辩状\n\n## 对各项诉讼请求的答辩\n\n诉请 1 驳'))
      .mockResolvedValueOnce({ ok: false, code: 'timeout', error: 'timed out' });
    const r = await generateDefense({ analysis: await analysis(), case: SAMPLE_CASE, draft: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('续写调用失败');
  });
});
