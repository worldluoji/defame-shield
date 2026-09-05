/**
 * placeholders 工具测试
 */
import { describe, it, expect } from 'vitest';
import { scanPlaceholders, dedupPlaceholders, replacePlaceholder } from '../src/utils/placeholders';

describe('scanPlaceholders', () => {
  it('扫描简单 [xxx] 占位符', () => {
    const text = '这是 [账号ID] 测试 [已尽到核实义务] 结束';
    const items = scanPlaceholders(text);
    expect(items).toHaveLength(2);
    expect(items[0]?.key).toBe('账号ID');
    expect(items[1]?.key).toBe('已尽到核实义务');
  });

  it('扫描 [待补充: ...] 占位符', () => {
    const text = '[待补充: 答辩人需要在此节陈述自身的客观事实]';
    const items = scanPlaceholders(text);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('todo');
  });

  it('跳过 markdown 链接 [text](url)', () => {
    const text = '参见 [法律条文](http://example.com)';
    const items = scanPlaceholders(text);
    expect(items).toHaveLength(0);
  });

  it('跳过纯数字脚注', () => {
    const text = '见 [1] 和 [2] 章节';
    const items = scanPlaceholders(text);
    expect(items).toHaveLength(0);
  });

  it('记录行号', () => {
    const text = '第一行\n第二行 [占位符]\n第三行 [另一个]';
    const items = scanPlaceholders(text);
    expect(items[0]?.line).toBe(2);
    expect(items[1]?.line).toBe(3);
  });
});

describe('dedupPlaceholders', () => {
  it('去重', () => {
    const items = [
      { raw: '[a]', key: 'a', line: 1, kind: 'short' as const },
      { raw: '[a]', key: 'a', line: 1, kind: 'short' as const },
      { raw: '[b]', key: 'b', line: 2, kind: 'short' as const },
    ];
    expect(dedupPlaceholders(items)).toHaveLength(2);
  });
});

describe('replacePlaceholder', () => {
  it('替换占位符', () => {
    const text = '被告 [账号ID] 实施了';
    expect(replacePlaceholder(text, '账号ID', '@李四微博')).toBe('被告 @李四微博 实施了');
  });

  it('多次出现只替换一次 (g flag)', () => {
    const text = '[xxx] 一次 [xxx] 两次';
    const out = replacePlaceholder(text, 'xxx', 'OK');
    expect(out).toBe('OK 一次 OK 两次');
  });

  it('不存在的占位符不变', () => {
    const text = '无占位符';
    expect(replacePlaceholder(text, 'xxx', 'OK')).toBe('无占位符');
  });
});
