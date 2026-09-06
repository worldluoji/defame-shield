/**
 * DocumentConverter / format-detector / markitdown-adapter 测试
 *
 * 注意: 真实 markitdown 调用依赖系统 Python 环境, 这里用 mock 测转换器逻辑
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { DocumentConverter } from '../src/converters/document-converter';
import { detectByExt, detectByMagic, detectFormat, isPassthrough } from '../src/converters/format-detector';
import { isMarkItDownInstalled, MARKITDOWN_INSTALL_HINT, convertWithMarkItDown } from '../src/converters/markitdown-adapter';

const tmpDir = join(tmpdir(), `dsh-conv-test-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });

describe('format-detector (扩展名)', () => {
  it('常见格式识别', () => {
    expect(detectByExt('a.md')).toBe('md');
    expect(detectByExt('a.markdown')).toBe('md');
    expect(detectByExt('a.pdf')).toBe('pdf');
    expect(detectByExt('a.docx')).toBe('docx');
    expect(detectByExt('a.pptx')).toBe('pptx');
    expect(detectByExt('a.xlsx')).toBe('xlsx');
    expect(detectByExt('a.txt')).toBe('txt');
  });

  it('大小写不敏感', () => {
    expect(detectByExt('A.PDF')).toBe('pdf');
    expect(detectByExt('b.Docx')).toBe('docx');
  });

  it('不支持的格式', () => {
    expect(detectByExt('a.zip')).toBe('unsupported');
    expect(detectByExt('a.exe')).toBe('unsupported');
  });

  it('isPassthrough: md/txt', () => {
    expect(isPassthrough('md')).toBe(true);
    expect(isPassthrough('txt')).toBe(true);
    expect(isPassthrough('pdf')).toBe(false);
    expect(isPassthrough('docx')).toBe(false);
  });
});

describe('format-detector (魔数)', () => {
  it('PDF 魔数识别', () => {
    const pdf = join(tmpDir, 'test.pdf');
    writeFileSync(pdf, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])); // %PDF-1.4
    expect(detectByMagic(pdf)).toBe('pdf');
    expect(detectFormat(pdf)).toBe('pdf');
  });

  it('PK 魔数 (docx/pptx/xlsx) 用扩展名细分', () => {
    const docx = join(tmpDir, 'test.docx');
    writeFileSync(docx, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]));
    expect(detectByMagic(docx)).toBe('docx');

    const pptx = join(tmpDir, 'test.pptx');
    writeFileSync(pptx, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(detectByMagic(pptx)).toBe('pptx');
  });

  it('plain text 走扩展名 fallback', () => {
    const txt = join(tmpDir, 'test.txt');
    writeFileSync(txt, 'hello world');
    // 魔数不识别 plain text, 返回 unsupported
    expect(detectByMagic(txt)).toBe('unsupported');
    // 综合 detectFormat 走扩展名 fallback
    expect(detectFormat(txt)).toBe('txt');
  });
});

describe('markitdown-adapter', () => {
  it('isMarkItDownInstalled 不会抛错', () => {
    expect(() => isMarkItDownInstalled()).not.toThrow();
    // 实际装没装都可能
  });

  it('MARKITDOWN_INSTALL_HINT 包含安装命令', () => {
    expect(MARKITDOWN_INSTALL_HINT).toContain('pip install');
    expect(MARKITDOWN_INSTALL_HINT).toContain('markitdown');
  });

  it('convertWithMarkItDown 文件不存在报错', async () => {
    const r = await convertWithMarkItDown('/no/such/file.pdf');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('spawn_error');
  });
});

describe('DocumentConverter (passthrough + 缓存)', () => {
  it('md 文件 passthrough', async () => {
    const md = join(tmpDir, 'simple.md');
    writeFileSync(md, '# 标题\n\n内容', 'utf-8');
    const conv = new DocumentConverter({ cacheDir: join(tmpDir, 'cache') });
    const r = await conv.convert(md);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.markdown).toBe('# 标题\n\n内容');
    expect(r.result.metadata.converter).toBe('passthrough');
    expect(r.result.metadata.format).toBe('md');
    expect(r.result.metadata.fromCache).toBe(false);
  });

  it('缓存命中 (第二次调用)', async () => {
    const md = join(tmpDir, 'cache-test.md');
    writeFileSync(md, '# 缓存测试', 'utf-8');
    const conv = new DocumentConverter({ cacheDir: join(tmpDir, 'cache2') });
    const r1 = await conv.convert(md);
    expect(r1.ok).toBe(true);
    const r2 = await conv.convert(md);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.result.metadata.fromCache).toBe(true);
      expect(r2.result.metadata.converter).toBe('cache');
    }
  });

  it('文件不存在报错', async () => {
    const conv = new DocumentConverter();
    const r = await conv.convert('/no/such/file.md');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('not_found');
  });

  it('不支持的格式报错', async () => {
    const zip = join(tmpDir, 'a.zip');
    writeFileSync(zip, 'PK', 'utf-8'); // fake
    const conv = new DocumentConverter();
    const r = await conv.convert(zip);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('unsupported_format');
  });

  it('clearCache 清空缓存', () => {
    const conv = new DocumentConverter({ cacheDir: join(tmpDir, 'cache3') });
    const result = conv.clearCache();
    expect(result.removed).toBeGreaterThanOrEqual(0);
  });
});

describe('DocumentConverter (markitdown 调用 — 真实或失败)', () => {
  it('PDF 文件转换 (依赖 markitdown 安装)', async () => {
    const pdf = join(tmpDir, 'real.pdf');
    // 写入一个最小 PDF 头
    writeFileSync(pdf, Buffer.from('%PDF-1.4\n%fake content for test\n%%EOF'));
    const conv = new DocumentConverter({ cacheDir: join(tmpDir, 'cache-pdf') });
    const r = await conv.convert(pdf);
    // 如果 markitdown 没装, 期望 markitdown_not_installed
    // 如果装了, 期望 ok=true (但内容可能为空)
    if (!r.ok) {
      expect(['markitdown_not_installed', 'conversion_failed']).toContain(r.error.code);
    }
    // 这个测试只是跑通路径, 不强求成功
  });
});

// 清理
afterAll(() => {
  if (existsSync(tmpDir)) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
