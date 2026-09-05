/**
 * PDF 转换测试
 */
import { describe, it, expect } from 'vitest';
import { existsSync, unlinkSync, readFileSync, statSync } from 'node:fs';
import { convertToPdf } from '../src/utils/pdf';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
import { writeFileSync } from 'node:fs';
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

  // 清理
  it('cleanup', () => {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
    if (existsSync(tmpPdf)) unlinkSync(tmpPdf);
  });
});
