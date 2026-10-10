/**
 * parseJsonLenient — LLM 畸形 JSON 逐级修复
 */
import { describe, it, expect } from 'vitest';
import { parseJsonLenient, extractJsonSource } from '../src/utils/json-extract';

describe('parseJsonLenient', () => {
  it('合法 JSON 原样通过, repaired=false', () => {
    const r = parseJsonLenient('{"a":1,"b":[1,2]}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repaired).toBe(false);
    expect(r.data).toEqual({ a: 1, b: [1, 2] });
  });

  it('尾逗号自动去除', () => {
    const r = parseJsonLenient('{"a":[1,2,],}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repaired).toBe(true);
    expect(r.data).toEqual({ a: [1, 2] });
  });

  it('数组元素缺逗号 — 按报错位置补逗号', () => {
    const r = parseJsonLenient('{"w":["a"\n"b"\n"c"]}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repaired).toBe(true);
    expect(r.data).toEqual({ w: ['a', 'b', 'c'] });
  });

  it('对象属性缺逗号', () => {
    const r = parseJsonLenient('{"a":"x"\n"b":2}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ a: 'x', b: 2 });
  });

  it('字符串中途截断 — 闭合引号并补全括号', () => {
    const r = parseJsonLenient('{"parties":{"原告":{"name":"张三"}},"claims":[{"index":1,"content":"赔礼道');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      parties: { 原告: { name: '张三' } },
      claims: [{ index: 1, content: '赔礼道' }],
    });
  });

  it('结尾悬挂冒号补 null', () => {
    const r = parseJsonLenient('{"a":1,"b":');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ a: 1, b: null });
  });

  it('结尾悬挂逗号丢弃', () => {
    const r = parseJsonLenient('{"a":[1,2,');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ a: [1, 2] });
  });

  it('彻底无语法结构 → ok:false 且带错误信息', () => {
    const r = parseJsonLenient('这不是 JSON, 起诉状拆解失败');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.length).toBeGreaterThan(0);
  });

  it('字符串内含转义引号不误判闭合', () => {
    const r = parseJsonLenient('{"a":"他说\\"继续\\" 然后');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ a: '他说"继续" 然后' });
  });

  it('extractJsonSource: markdown 围栏优先', () => {
    const src = extractJsonSource('前缀文字\n```json\n{"a":1}\n```\n后缀');
    expect(src).toBe('{"a":1}');
  });
});
