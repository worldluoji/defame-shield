import { describe, it, expect } from 'vitest';
import { stripMdFence } from '../src/utils/md.js';

describe('stripMdFence', () => {
  it('剥掉整篇 markdown 围栏', () => {
    expect(stripMdFence('```markdown\n# 标题\n\n正文\n```')).toBe('# 标题\n\n正文');
  });

  it('剥掉裸 ``` 围栏', () => {
    expect(stripMdFence('```\n内容\n```')).toBe('内容');
  });

  it('无围栏时原样返回 (仅 trim)', () => {
    expect(stripMdFence('\n# 标题\n正文\n')).toBe('# 标题\n正文');
  });

  it('围栏内的代码块不误伤: 只有整篇被围栏包裹才剥', () => {
    const s = '开头\n\n```js\nconsole.log(1)\n```\n\n结尾';
    expect(stripMdFence(s)).toBe(s);
  });

  it('文中有 ``` 但首尾无围栏 → 不动', () => {
    const s = '``` 未闭合的引用';
    expect(stripMdFence(s)).toBe(s);
  });
});
