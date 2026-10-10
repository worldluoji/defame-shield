/**
 * ai-parse / complaint-parser — LLM 畸形输出的修复与兜底
 */
import { describe, it, expect, vi } from 'vitest';
import { parseAndValidateLLMJson } from '../src/analyzer/ai-parse';
import { analyzeComplaint } from '../src/analyzer/complaint-parser';

vi.mock('../src/llm/client.js', () => ({
  callLLM: vi.fn().mockResolvedValue({
    ok: true,
    text: '这不是 JSON, 只是一段普通文字回复',
    provider: 'deepseek',
    model: 'deepseek-flash',
    elapsedMs: 100,
  }),
}));

const MINIMAL_LLM_JSON = JSON.stringify({
  parties: { 原告: { name: '张三' }, 被告: { name: '李四' } },
  cause: '名誉权纠纷',
  claims: [{ index: 1, content: '赔礼道歉', type: 'restore_reputation' }],
  facts: { tortMethod: '微博', tortContent: '言论', spread: '公开' },
  legalBasis: ['民法典 1024'],
});

describe('parseAndValidateLLMJson 宽松修复', () => {
  it('合法输出正常通过', () => {
    const r = parseAndValidateLLMJson(MINIMAL_LLM_JSON, 'test.md');
    expect(r.ok).toBe(true);
  });

  it('缺逗号畸形被修复, 且 warnings 透明标注', () => {
    const malformed = MINIMAL_LLM_JSON.replace('"spread":"公开"', '"spread":"公开"\n"备注":"x"');
    const r = parseAndValidateLLMJson(malformed, 'test.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.analysis.warnings.some((w) => w.includes('自动修复'))).toBe(true);
  });

  it('截断输出尽量抢救并标注 (关键字段齐全才放行)', () => {
    // 截掉 legalBasis 尾段: parties/claims/facts 保留 → 应能修复
    const truncated = MINIMAL_LLM_JSON.slice(0, MINIMAL_LLM_JSON.indexOf('"legalBasis"'));
    const r = parseAndValidateLLMJson(truncated, 'test.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.analysis.parties.原告.name).toBe('张三');
    expect(r.analysis.facts.tortMethod).toBe('微博');
    expect(r.analysis.warnings.some((w) => w.includes('自动修复'))).toBe(true);

    // 截掉 facts 段 → 关键字段缺失, 宁缺毋滥, 拒绝而不是带残缺入库
    const tooShort = MINIMAL_LLM_JSON.slice(0, MINIMAL_LLM_JSON.length - 30);
    const r2 = parseAndValidateLLMJson(tooShort, 'test.md');
    expect(r2.ok).toBe(false);
  });

  it('完全非 JSON → ok:false', () => {
    const r = parseAndValidateLLMJson('抱歉, 我无法完成该任务。', 'test.md');
    expect(r.ok).toBe(false);
  });
});

describe('analyzeComplaint AI 输出畸形 → partialDraft 兜底', () => {
  it('mock callLLM 返回非 JSON: invalid_format + partialDraft', async () => {
    const complaint = `# 民事起诉状

## 原告

- **姓名/名称**：张三
- **住所地**：北京市东城区某某路 1 号

## 被告

- **姓名/名称**：李四

## 诉讼请求

1. 依法判令被告立即停止对原告名誉权的侵害;
2. 依法判令被告赔偿原告精神损害抚慰金人民币 50000 元。

## 事实与理由

2025 年 5 月 1 日, 被告通过其微博账号发布针对原告张三的诽谤性言论, 严重损害了原告的社会评价。
`;
    const res = await analyzeComplaint(complaint, { draft: false });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('invalid_format');
    expect(res.partialDraft).toBeDefined();
    expect(res.partialDraft?.parties.原告.name).toBe('张三');
  });
});
