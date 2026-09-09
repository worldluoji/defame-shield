/**
 * 扫描 + 解析答辩状里的 [待补充] / [xxx] 占位符
 */

export interface PlaceholderItem {
  /** 占位符原文 (含 [ ]) */
  raw: string;
  /** 提取的 key (方括号里的内容) */
  key: string;
  /** 在原文中的行号 (1-indexed) */
  line: number;
  /** 占位符类型: 待补充 / 短占位符 / 长占位符 */
  kind: 'todo' | 'short' | 'long';
}

/** 扫描所有 [xxx] 占位符 (含待补充) */
export function scanPlaceholders(text: string): PlaceholderItem[] {
  const lines = text.split('\n');
  const items: PlaceholderItem[] = [];
  // 匹配: [待补充: xxx] / [待补充] / [xxx] / [xxx xxx]
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    const reLine = /\[([^[\]\n]{1,200})\]/g;
    while ((m = reLine.exec(line)) !== null) {
      const raw = m[0];
      const key = m[1]!.trim();
      // 跳过 markdown 链接 [text](url)
      if (line.indexOf('](') > m.index && line.indexOf('](') < m.index + raw.length) continue;
      // 跳过 [数字] 类脚注 / 引用标记
      if (/^\d+$/.test(key)) continue;
      items.push({
        raw,
        key,
        line: i + 1,
        kind: key.startsWith('待补充') ? 'todo' : key.length > 30 ? 'long' : 'short',
      });
    }
  }
  return items;
}

/**
 * 按行号去重合并 (一个长待补充可能跨行)
 * 实际上一个 [xxx] 占位符必然在一行内, 但有时 [待补充: ...] 后面跟换行继续写
 * 这里做简单的"按 raw + 行号"去重
 */
export function dedupPlaceholders(items: PlaceholderItem[]): PlaceholderItem[] {
  const seen = new Set<string>();
  const result: PlaceholderItem[] = [];
  for (const item of items) {
    const key = `${item.line}:${item.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * 替换占位符: 在文本中找到所有 [key], 用 value 替换 (首次出现)
 */
export function replacePlaceholder(text: string, key: string, value: string): string {
  // 转义正则特殊字符
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[\\s*${escaped}\\s*\\]`, 'g');
  return text.replace(re, () => value);
}
