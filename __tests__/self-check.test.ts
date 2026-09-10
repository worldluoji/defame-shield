/**
 * 抗辩自检器单元测试
 */
import { describe, it, expect } from 'vitest';
import { selfCheckDefense } from '../src/rebuttal/self-check';
import { generateDefense } from '../src/generators/defense';
import { analyzeComplaint } from '../src/analyzer/complaint-parser';
import type { ComplaintAnalysis } from '../src/analyzer/complaint-types';
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

具状人：张三

2025 年 9 月 10 日
`;

const SAMPLE_CASE: Case = {
  id: 'def-001',
  title: '测试',
  cause: '网络侵权名誉权',
  plaintiff: { name: '张三', role: '原告' },
  defendant: { name: '李四', role: '被告' },
  facts: '',
  claims: [],
  evidence: [],
  court: '北京市东城区人民法院',
  createdAt: '',
  updatedAt: '',
};

async function genDefense(analysis: ComplaintAnalysis): Promise<string> {
  const r = await generateDefense({ analysis, case: SAMPLE_CASE, draft: true });
  if (!r.ok) throw new Error(r.error);
  return r.content;
}

describe('selfCheckDefense (rule 模式)', () => {
  it('基础运行, 至少找出 1 个漏洞', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const defense = await genDefense(a.analysis);
    const r = await selfCheckDefense({ defense, analysis: a.analysis, mode: 'rule' });
    expect(r.ok).toBe(true);
    expect(r.vulnerabilities.length).toBeGreaterThanOrEqual(1);
  });

  it('找出 [待补充] 占位符漏洞 (critical)', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const defense = await genDefense(a.analysis);
    const r = await selfCheckDefense({ defense, analysis: a.analysis, mode: 'rule' });
    expect(r.vulnerabilities.some((v) => v.id === 'unfilled-placeholders' && v.risk === 'critical')).toBe(true);
  });

  it('程序性反点适用但未采用时, 警告 critical', async () => {
    const oldComplaint = SAMPLE_COMPLAINT.replace(
      '被告通过微博账号 @李四微博',
      '2021 年 3 月, 被告通过微博账号 @李四微博',
    );
    const a = await analyzeComplaint(oldComplaint, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    // 构造一个不含 statute-limitations 的答辩状 (删掉所有 "超过诉讼时效" 字符串)
    const brokenDefense = '这是答辩状. 不含程序性反点. 也没有完整法条. 只有 民法典. 共 3 处. 没有 [待补充] 占位符, 也没有 反点. 诉请 1: 答辩. 诉请 2: 答辩. 诉请 3: 答辩. 诉请 4: 答辩. 诉请 5: 答辩. 法律依据: 第1024条. 第1025条. 第1183条. 第六十七条. 第一百八十八条.';
    const r = await selfCheckDefense({ defense: brokenDefense, analysis: a.analysis, mode: 'rule' });
    // 应该提示 missing-statute-limitations
    expect(r.vulnerabilities.some((v) => v.id === 'missing-statute-limitations' && v.risk === 'critical')).toBe(true);
  });

  it('完整答辩评分高于空壳答辩 (评分有区分度)', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const defense = await genDefense(a.analysis);
    const full = await selfCheckDefense({ defense, analysis: a.analysis, mode: 'rule' });
    expect(full.overallScore).toBeGreaterThanOrEqual(0);
    expect(full.overallScore).toBeLessThanOrEqual(100);

    const broken = await selfCheckDefense({ defense: '这是答辩状。', analysis: a.analysis, mode: 'rule' });
    expect(full.overallScore).toBeGreaterThan(broken.overallScore);
  });

  it('漏洞按风险等级排序', async () => {
    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const defense = await genDefense(a.analysis);
    const r = await selfCheckDefense({ defense, analysis: a.analysis, mode: 'rule' });
    const risks = r.vulnerabilities.map((v) => v.risk);
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 0; i < risks.length - 1; i++) {
      expect(order[risks[i]!]).toBeLessThanOrEqual(order[risks[i + 1]!]!);
    }
  });
});

describe('selfCheckDefense (AI 模式失败回退)', () => {
  it('LLM 不可用时 AI 模式仍可运行 (返回空 AI 列表)', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    process.env.MODEL_PROVIDER = 'deepseek';

    const a = await analyzeComplaint(SAMPLE_COMPLAINT, { draft: true });
    if (!a.ok) throw new Error('analyze fail');
    const defense = await genDefense(a.analysis);
    const r = await selfCheckDefense({ defense, analysis: a.analysis, mode: 'hybrid' });
    expect(r.ok).toBe(true);
    // AI 部分失败时, 至少 rule 部分的结果保留
    expect(r.vulnerabilities.length).toBeGreaterThanOrEqual(1);
  });
});
