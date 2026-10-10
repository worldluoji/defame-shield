/**
 * dsh convert — 文件格式转换 (.pdf/.docx → markdown)
 *
 * dsh convert <input> [-o output.md] [--no-cache] [--print-meta]
 * dsh convert --check  (仅检查 markitdown, 不需要文件)
 */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { DocumentConverter, visibleTextCount, LOW_TEXT_WARN_THRESHOLD } from '../converters/document-converter.js';
import { out, die } from '../utils/console.js';

export interface ConvertFlags {
  out?: string;
  /** commander 的 --no-cache 存为 cache: false */
  cache?: boolean;
  printMeta?: boolean;
  check?: boolean;
  /** 强制纯 Node 路径 (pdf/docx) */
  native?: boolean;
}

export async function convertCommand(input: string | undefined, flags: ConvertFlags): Promise<void> {
  const converter = new DocumentConverter({ preferNative: flags.native });

  if (flags.check) {
    const deps = converter.checkDependencies();
    out.info('纯 Node 兜底 (mammoth + pdf.js): 可用 — 文字版 pdf / docx');
    if (deps.markitdownInstalled) {
      out.success('markitdown 已安装 — pptx/xlsx/html/表格增强可用');
    } else {
      out.warn('markitdown 未安装 — pptx/xlsx/html 不可用; pdf/docx 自动走纯 Node 兜底');
      out.info('安装提示 (可选, ./scripts/setup.sh):');
      out.log(deps.installHint ?? '');
    }
    return;
  }

  if (!input) die('用法: dsh convert <file> 或 dsh convert --check');
  if (!existsSync(input)) die(`文件不存在: ${input}`);

  const useCache = flags.cache !== false;
  out.info(`转换: ${basename(input)}  (缓存: ${useCache ? 'on' : 'off'})`);

  const result = await converter.convert(input, useCache);

  if (!result.ok) {
    out.error(result.error.error);
    if (result.error.installHint) {
      out.info('安装提示:');
      out.log(result.error.installHint);
    }
    process.exit(1);
  }

  // 输出路径
  const outPath = flags.out ?? input.replace(/\.[^./\\]+$/, '') + '.md';
  const outDir = dirname(outPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, result.result.markdown, 'utf-8');

  out.success(`已写入: ${outPath}`);
  const conv = result.result.metadata.converter;
  out.info(`格式: ${result.result.metadata.format}  /  转换器: ${conv}  /  缓存: ${result.result.metadata.fromCache ? '命中' : 'miss'}`);
  if (conv !== 'passthrough' && visibleTextCount(result.result.markdown) < LOW_TEXT_WARN_THRESHOLD) {
    out.warn(`提取到的文字极少 (${visibleTextCount(result.result.markdown)} 字) — 疑似扫描版/图片版, 拆解结果必然失真; 按报错指引换源文件或先 OCR`);
  }
  if ((conv === 'native-pdf' || conv === 'native-docx') && !flags.native) {
    out.info('当前为纯 Node 兜底结果; 如需更好结构 (表格/pptx/xlsx), 安装 markitdown: ./scripts/setup.sh');
  }
  if (result.result.metadata.durationMs) {
    out.info(`耗时: ${result.result.metadata.durationMs}ms`);
  }
  if (flags.printMeta) {
    out.log('\n元数据:');
    out.log(JSON.stringify(result.result.metadata, null, 2));
  }
}
