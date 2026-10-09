/**
 * DocumentConverter 路由测试 — markitdown 与 native 兜底的分工 (mock, 不碰真实环境)
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  installed: true,
  convertPdfNative: vi.fn(),
  convertDocxNative: vi.fn(),
  convertWithMarkItDown: vi.fn(),
}));

vi.mock('../src/converters/native-converters', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/converters/native-converters')>();
  return { ...orig, convertPdfNative: mocks.convertPdfNative, convertDocxNative: mocks.convertDocxNative };
});

vi.mock('../src/converters/markitdown-adapter', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/converters/markitdown-adapter')>();
  return {
    ...orig,
    isMarkItDownInstalled: () => mocks.installed,
    convertWithMarkItDown: mocks.convertWithMarkItDown,
  };
});

import { DocumentConverter } from '../src/converters/document-converter';

const tmpDir = join(tmpdir(), `dsh-fallback-test-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });

let fileSeq = 0;
/** 每个用例新文件 + 新 cacheDir, 避免缓存串扰 */
function makeFile(ext: string, magic: string, opts: { cacheDir?: string } = {}): { path: string; conv: DocumentConverter } {
  const name = `f${++fileSeq}.${ext}`;
  const path = join(tmpDir, name);
  writeFileSync(path, Buffer.from(magic, 'utf-8'));
  return { path, conv: new DocumentConverter({ cacheDir: opts.cacheDir ?? join(tmpDir, `cache-${fileSeq}`) }) };
}

beforeEach(() => {
  mocks.installed = true;
  mocks.convertPdfNative.mockReset().mockResolvedValue({ ok: true, markdown: '# native-pdf', pageCount: 2, durationMs: 1 });
  mocks.convertDocxNative.mockReset().mockResolvedValue({ ok: true, markdown: '# native-docx', durationMs: 1 });
  mocks.convertWithMarkItDown.mockReset().mockResolvedValue({ ok: true, markdown: '# markitdown', durationMs: 1 });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('markitdown 未安装', () => {
  it('pdf 自动走 native-pdf 兜底', async () => {
    mocks.installed = false;
    const { path, conv } = makeFile('pdf', '%PDF-1.4 body');
    const r = await conv.convert(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.metadata.converter).toBe('native-pdf');
    expect(r.result.metadata.pageCount).toBe(2);
  });

  it('docx 自动走 native-docx 兜底', async () => {
    mocks.installed = false;
    const { path, conv } = makeFile('docx', 'PK body');
    const r = await conv.convert(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.metadata.converter).toBe('native-docx');
  });

  it('pptx 无兜底 → markitdown_not_installed', async () => {
    mocks.installed = false;
    const { path, conv } = makeFile('pptx', 'PK body');
    const r = await conv.convert(path);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('markitdown_not_installed');
  });

  it('native 兜底也失败 → conversion_failed 且带安装提示', async () => {
    mocks.installed = false;
    mocks.convertPdfNative.mockResolvedValue({ ok: false, code: 'no_output', error: 'PDF 无可提取文本' });
    const { path, conv } = makeFile('pdf', '%PDF-1.4 body');
    const r = await conv.convert(path);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('conversion_failed');
    expect(r.error.installHint).toContain('markitdown');
  });
});

describe('markitdown 已安装', () => {
  it('pdf 优先 markitdown', async () => {
    const { path, conv } = makeFile('pdf', '%PDF-1.4 body');
    const r = await conv.convert(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.metadata.converter).toBe('markitdown');
    expect(mocks.convertWithMarkItDown).toHaveBeenCalled();
    expect(mocks.convertPdfNative).not.toHaveBeenCalled();
  });

  it('preferNative 强制纯 Node 路径', async () => {
    const { path } = makeFile('pdf', '%PDF-1.4 body');
    const conv = new DocumentConverter({ cacheDir: join(tmpDir, 'cache-native'), preferNative: true });
    const r = await conv.convert(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.metadata.converter).toBe('native-pdf');
    expect(mocks.convertWithMarkItDown).not.toHaveBeenCalled();
  });

  it('markitdown 失败时 pdf 降级 native 且不污染缓存', async () => {
    const cacheDir = join(tmpDir, 'cache-degrade');
    const { path, conv } = makeFile('pdf', '%PDF-1.4 body', { cacheDir });
    mocks.convertWithMarkItDown.mockResolvedValue({ ok: false, code: 'timeout', error: 'markitdown 超时' });
    const r = await conv.convert(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.metadata.converter).toBe('native-pdf');
    expect(r.result.metadata.fromCache).toBe(false);

    // markitdown 恢复后重新转换应走 markitdown (降级结果没写进缓存)
    mocks.convertWithMarkItDown.mockResolvedValue({ ok: true, markdown: '# markitdown', durationMs: 1 });
    const conv2 = new DocumentConverter({ cacheDir });
    const r2 = await conv2.convert(path);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.result.metadata.converter).toBe('markitdown');
  });

  it('markitdown 失败 + pptx → conversion_failed (无兜底)', async () => {
    mocks.convertWithMarkItDown.mockResolvedValue({ ok: false, code: 'non_zero_exit', error: 'exit 2' });
    const { path, conv } = makeFile('pptx', 'PK body');
    const r = await conv.convert(path);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('conversion_failed');
  });
});', '