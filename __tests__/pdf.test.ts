/**
 * PDF 转换测试
 */
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, unlinkSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { convertToPdf, findCjkTtf } from '../src/utils/pdf';
import { convertPdfNative } from '../src/converters/native-converters';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const extraCleanup: string[] = [];

const SAMPLE_MD = `# 测试文档

## 第一节

这是一个测试段落, 用于验证 PDF 转换是否成功.

## 第二节

- 列表项 1
- 列表项 2
- 列表项 3

**重点内容**: 这部分应该加粗显示.

`;

const tmpFile = join(tmpdir(), `dsh-pdf-test-${Date.now()}.md`);
const tmpPdf = join(tmpdir(), `dsh-pdf-test-${Date.now()}.pdf`);
// 准备文件
writeFileSync(tmpFile, SAMPLE_MD, 'utf-8');

describe('convertToPdf', () => {
  it('生成有效 PDF 文件', async () => {
    await convertToPdf(tmpFile, { output: tmpPdf, title: '测试' });
    expect(existsSync(tmpPdf)).toBe(true);
    const stat = statSync(tmpPdf);
    expect(stat.size).toBeGreaterThan(1000); // 至少 1KB
  });

  it('PDF 文件头是 %PDF-', async () => {
    const buf = readFileSync(tmpPdf, { encoding: 'utf-8' }).slice(0, 10);
    expect(buf.startsWith('%PDF-')).toBe(true);
  });

  it('缺文件报错', async () => {
    await expect(convertToPdf('/no/such/file.md', { output: tmpPdf })).rejects.toThrow();
  });

  it('页码不产生空白第 2 页 (回归: width+align 会触发 pdfkit 误判溢出)', async () => {
    await convertToPdf(tmpFile, { output: tmpPdf, title: '单页' });
    const r = await convertPdfNative(tmpPdf);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pageCount).toBe(1);
  });
});

const TABLE_MD = `# Evidence Table

| No. | Evidence Name | Proof Purpose |
|---|---|---|
| 1 | Post screenshot | Existence of content |
| 2 | Notarized record | Spread scope |

After table paragraph.
`;

describe('convertToPdf (表格渲染)', () => {
  it('表格单元格文本在生成 PDF 中可提取', async () => {
    const md = join(tmpdir(), `dsh-table-${Date.now()}.md`);
    const pdf = join(tmpdir(), `dsh-table-${Date.now()}.pdf`);
    extraCleanup.push(md, pdf);
    writeFileSync(md, TABLE_MD, 'utf-8');
    await convertToPdf(md, { output: pdf });
    const r = await convertPdfNative(pdf);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.markdown).toContain('Evidence Name');
    expect(r.markdown).toContain('Notarized record');
    expect(r.markdown).toContain('After table paragraph');
  });

  it('长表格跨页不丢行', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => `| r${i} | row-${i} | note-${i} |`).join('\n');
    const md = join(tmpdir(), `dsh-longtable-${Date.now()}.md`);
    const pdf = join(tmpdir(), `dsh-longtable-${Date.now()}.pdf`);
    extraCleanup.push(md, pdf);
    writeFileSync(md, `# Long Table\n\n| A | B | C |\n|---|---|---|\n${rows}\n`, 'utf-8');
    await convertToPdf(md, { output: pdf });
    const r = await convertPdfNative(pdf);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pageCount).toBeGreaterThanOrEqual(2);
    expect(r.markdown).toContain('row-0');
    expect(r.markdown).toContain('row-59');
  });
});

describe('findCjkTtf', () => {
  it('CHINESE_TTF 环境变量优先', () => {
    const fake = join(tmpdir(), `dsh-font-${Date.now()}.ttf`);
    writeFileSync(fake, 'fake');
    extraCleanup.push(fake);
    const prev = process.env['CHINESE_TTF'];
    process.env['CHINESE_TTF'] = fake;
    try {
      expect(findCjkTtf()).toBe(fake);
    } finally {
      if (prev === undefined) delete process.env['CHINESE_TTF'];
      else process.env['CHINESE_TTF'] = prev;
    }
  });
});

afterAll(() => {
  if (existsSync(tmpFile)) unlinkSync(tmpFile);
  if (existsSync(tmpPdf)) unlinkSync(tmpPdf);
  for (const f of extraCleanup) {
    if (existsSync(f)) unlinkSync(f);
  }
});
