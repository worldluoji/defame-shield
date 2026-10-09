/**
 * 纯 Node 兜底转换器 — 文字版 PDF / docx → markdown
 *
 * 定位:
 *   - markitdown 不可用时自动启用 (仅 pdf/docx), 有它则 markitdown 优先 (结构质量更好)
 *   - 无 OCR: 扫描版 PDF 提取为空, 报 no_output
 *   - pptx/xlsx/html 仍依赖 markitdown
 *
 * 实现: docx → mammoth (Word XML → markdown)
 *       文字版 PDF → pdf-parse 2.x (pdf.js 文本提取)
 */
import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { SupportedFormat } from './format-detector.js';

export interface NativeSuccess {
  ok: true;
  markdown: string;
  /** PDF 页数 (docx 无) */
  pageCount?: number;
  durationMs: number;
}

export interface NativeFailure {
  ok: false;
  error: string;
  code: 'read_failed' | 'parse_failed' | 'no_output';
}

export type NativeResult = NativeSuccess | NativeFailure;

/** 纯 Node 路径支持的格式 (其余走 markitdown) */
export function isNativeSupported(format: SupportedFormat): format is 'pdf' | 'docx' {
  return format === 'pdf' || format === 'docx';
}

/** docx → markdown (保留标题/列表/表格结构; 图片/批注忽略) */
export async function convertDocxNative(filePath: string): Promise<NativeResult> {
  const start = Date.now();
  let markdown: string;
  try {
    const result = await mammoth.convertToMarkdown({ path: filePath });
    markdown = result.value;
  } catch (e) {
    return { ok: false, code: 'parse_failed', error: `docx 解析失败: ${(e as Error).message}` };
  }
  if (!markdown.trim()) {
    return { ok: false, code: 'no_output', error: 'docx 提取结果为空 (可能纯图片内容)' };
  }
  return { ok: true, markdown, durationMs: Date.now() - start };
}

/** 文字版 PDF → 纯文本 (页间空行分隔; 扫描版不支持) */
export async function convertPdfNative(filePath: string): Promise<NativeResult> {
  const start = Date.now();
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (e) {
    return { ok: false, code: 'read_failed', error: `无法读取 PDF: ${(e as Error).message}` };
  }

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const text = await parser.getText();
    const joined = text.pages.map((p) => p.text).join('\n\n');
    if (!joined.trim()) {
      return {
        ok: false,
        code: 'no_output',
        error: 'PDF 无可提取文本 (可能是扫描版); 需 OCR 请安装 markitdown 或改用 Word 源文件',
      };
    }
    return { ok: true, markdown: joined, pageCount: text.total, durationMs: Date.now() - start };
  } catch (e) {
    return { ok: false, code: 'parse_failed', error: `PDF 解析失败: ${(e as Error).message}` };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
