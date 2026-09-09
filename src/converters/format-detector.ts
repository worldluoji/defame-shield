/**
 * 文档格式检测 — 按扩展名 + 魔数 (magic bytes) 联合判断
 */
import { existsSync, openSync, readSync, closeSync } from 'node:fs';

export type SupportedFormat = 'md' | 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'txt' | 'html' | 'unsupported';

/** 扩展名 → 格式 (MarkItDown 支持的) */
const EXT_MAP: Record<string, SupportedFormat> = {
  '.md': 'md',
  '.markdown': 'md',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'docx', // 旧版 Word, markitdown 可能不支持
  '.pptx': 'pptx',
  '.ppt': 'pptx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.txt': 'txt',
  '.html': 'html',
  '.htm': 'html',
};

/** 魔数 → 格式 (读取文件前 16 字节) */
const MAGIC_MAP: Array<{ magic: number[]; format: SupportedFormat; minLen: number }> = [
  { magic: [0x25, 0x50, 0x44, 0x46], format: 'pdf', minLen: 4 }, // %PDF
  { magic: [0x50, 0x4b, 0x03, 0x04], format: 'docx', minLen: 4 }, // PK.. (ZIP, 也是 docx/pptx/xlsx 的容器)
  // 注: PK 同时表示 docx/pptx/xlsx, 需结合扩展名区分
];

/** 按扩展名检测 */
export function detectByExt(filePath: string): SupportedFormat {
  const ext = filePath.toLowerCase().match(/\.[^./\\]+$/)?.[0];
  if (!ext) return 'unsupported';
  return EXT_MAP[ext] ?? 'unsupported';
}

/** 按魔数检测 (需要读文件头) */
export function detectByMagic(filePath: string): SupportedFormat {
  if (!existsSync(filePath)) return 'unsupported';

  let buffer: Buffer;
  try {
    const fd = openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(16);
      readSync(fd, buf, 0, 16, 0);
      buffer = buf;
    } finally {
      closeSync(fd);
    }
  } catch {
    return 'unsupported';
  }

  for (const m of MAGIC_MAP) {
    if (buffer.length < m.minLen) continue;
    let match = true;
    for (let i = 0; i < m.magic.length; i++) {
      if (buffer[i] !== m.magic[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      // PK 魔数表示 ZIP 容器 (docx/pptx/xlsx)
      // 用扩展名细分; 任意 .zip 不能误报为 docx
      if (m.format === 'docx') {
        const ext = detectByExt(filePath);
        return ext === 'docx' || ext === 'pptx' || ext === 'xlsx' ? ext : 'unsupported';
      }
      return m.format;
    }
  }
  return 'unsupported';
}

/** 综合检测: 优先魔数, fallback 到扩展名 */
export function detectFormat(filePath: string): SupportedFormat {
  if (!existsSync(filePath)) return 'unsupported';
  const byMagic = detectByMagic(filePath);
  if (byMagic !== 'unsupported') return byMagic;
  return detectByExt(filePath);
}

/** MarkItDown 不直接支持但工具链支持 (passthrough) 的格式 */
export function isPassthrough(format: SupportedFormat): boolean {
  return format === 'md' || format === 'txt';
}
