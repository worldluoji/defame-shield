/**
 * dsh export pdf — Markdown → PDF 转换
 */
import { existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { convertToPdf } from '../utils/pdf.js';
import { out, die } from '../utils/console.js';

export interface PdfFlags {
  /** 输出路径, 默认 <md>-<同名>.pdf */
  out?: string;
  /** 案号 (页脚显示) */
  caseNumber?: string;
  /** 文档标题 (PDF 元数据) */
  title?: string;
}

export async function exportPdfCommand(mdPath: string, flags: PdfFlags): Promise<void> {
  if (!existsSync(mdPath)) die(`Markdown 文件不存在: ${mdPath}`);

  const output = flags.out ?? join(
    dirname(mdPath),
    basename(mdPath).replace(/\.md$/, '') + '.pdf',
  );

  out.info(`转换: ${basename(mdPath)} → ${basename(output)}`);
  if (flags.caseNumber) out.dim(`案号: ${flags.caseNumber}`);

  const start = Date.now();
  try {
    await convertToPdf(mdPath, {
      output,
      caseNumber: flags.caseNumber,
      title: flags.title ?? basename(mdPath).replace(/\.md$/, ''),
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    out.success(`已生成: ${output}  (${elapsed}s)`);
  } catch (err) {
    die(`PDF 转换失败: ${(err as Error).message}`);
  }
}
