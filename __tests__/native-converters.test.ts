/**
 * native-converters 测试 — 真实文字版 PDF 往返 (pdfkit 生成 → pdf.js 提取), 全程离线
 *
 * docx 路径: 仓库不内置 docx 样本, mammoth 的成功/失败分支在 native-fallback.test.ts 用 mock 覆盖;
 * 这里只测入参错误场景。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { convertToPdf } from '../src/utils/pdf';
import { convertPdfNative, convertDocxNative, isNativeSupported } from '../src/converters/native-converters';

const tmpDir = join(tmpdir(), `dsh-native-test-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });

const FIXTURE_MD = `## Tort Claim

Hello dsh native converter.

- item alpha
- item beta
`;

let pdfPath = '';

beforeAll(async () => {
  const mdPath = join(tmpDir, 'fixture.md');
  writeFileSync(mdPath, FIXTURE_MD, 'utf-8');
  pdfPath = join(tmpDir, 'fixture.pdf');
  await convertToPdf(mdPath, { output: pdfPath, title: 'fixture' });
});

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('isNativeSupported', () => {
  it('pdf/docx 支持, 其余不支持', () => {
    expect(isNativeSupported('pdf')).toBe(true);
    expect(isNativeSupported('docx')).toBe(true);
    expect(isNativeSupported('pptx')).toBe(false);
    expect(isNativeSupported('xlsx')).toBe(false);
    expect(isNativeSupported('html')).toBe(false);
    expect(isNativeSupported('md')).toBe(false);
  });
});

describe('convertPdfNative (真实往返)', () => {
  it('提取 pdfkit 写入的文本', async () => {
    const r = await convertPdfNative(pdfPath);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.markdown).toContain('Hello dsh native converter');
    expect(r.markdown).toContain('Tort Claim');
    expect(r.pageCount).toBeGreaterThanOrEqual(1);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('文件不存在 → read_failed', async () => {
    const r = await convertPdfNative(join(tmpDir, 'no-such.pdf'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('read_failed');
  });

  it('伪造 PDF 内容 → parse_failed', async () => {
    const fake = join(tmpDir, 'fake.pdf');
    writeFileSync(fake, '%PDF-1.4\nthis is not a parseable pdf body\n%%EOF');
    const r = await convertPdfNative(fake);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('parse_failed');
  });
});

describe('convertDocxNative', () => {
  it('文件不存在 → parse_failed (不抛)', async () => {
    const r = await convertDocxNative(join(tmpDir, 'no-such.docx'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('parse_failed');
  });
});
