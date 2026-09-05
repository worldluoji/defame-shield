/**
 * render.ts 单元测试 — 模板变量替换核心
 */
import { describe, it, expect } from 'vitest';
import { renderTemplate, caseToVars } from '../src/generators/render';
import type { Case } from '../src/case/types';

const sampleCase: Case = {
  id: 'test-001',
  title: '测试案件',
  cause: '网络侵权名誉权',
  plaintiff: { name: '张三', role: '原告' },
  defendant: { name: '李四', role: '被告' },
  facts: '被告通过微博发布侵权内容为"测试侵权内容"等。',
  claims: [{ content: '判令停止侵害' }],
  evidence: [
    { index: 1, name: '截图', kind: '电子数据', purpose: '证明侵权行为' },
  ],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

describe('renderTemplate', () => {
  it('替换简单变量', () => {
    const out = renderTemplate('Hello {{ name }}', { name: '张三' });
    expect(out).toBe('Hello 张三');
  });

  it('替换嵌套对象字段', () => {
    const out = renderTemplate('原告: {{ 原告.name }}', { 原告: { name: '张三' } });
    expect(out).toBe('原告: 张三');
  });

  it('支持点路径 literal key (e.g. 案件事实.侵权内容)', () => {
    const out = renderTemplate('内容: {{ 案件事实.侵权内容 }}', { '案件事实.侵权内容': 'abc' });
    expect(out).toBe('内容: abc');
  });

  it('空字符串视为占位符', () => {
    const out = renderTemplate('地址: {{ addr }}', { addr: '' });
    expect(out).toBe('地址: __________');
  });

  it('undefined 视为占位符', () => {
    const out = renderTemplate('地址: {{ addr }}', {});
    expect(out).toBe('地址: __________');
  });

  it('字符串值 trim', () => {
    const out = renderTemplate('name: {{ n }}', { n: '  张三  ' });
    expect(out).toBe('name: 张三');
  });

  it('对象值用 JSON.stringify', () => {
    const out = renderTemplate('{{ obj }}', { obj: { a: 1 } });
    expect(out).toBe('{\n  "a": 1\n}');
  });
});

describe('caseToVars', () => {
  it('把 Case 拍平为模板 vars', () => {
    const vars = caseToVars(sampleCase);
    expect(vars.id).toBe('test-001');
    expect(vars.title).toBe('测试案件');
    expect(vars['案件事实.侵权方式']).toBe('微博');
    expect(vars['案件事实.侵权内容']).toContain('测试侵权内容');
    expect(vars.证据数量).toBe(1);
  });

  it('证据表格行渲染为 Markdown', () => {
    const vars = caseToVars(sampleCase);
    expect(vars.证据表格行).toContain('| 1 |');
    expect(vars.证据表格行).toContain('电子数据');
  });

  it('各证据种类数量', () => {
    const vars = caseToVars(sampleCase);
    expect(vars.电子数据数量).toBe(1);
    expect(vars.书证数量).toBe(0);
  });
});
