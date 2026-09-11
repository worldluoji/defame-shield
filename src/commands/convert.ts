/**
 * dsh convert — 文件格式转换 (.pdf/.docx → markdown)
 *
 * dsh convert <input> [-o output.md] [--no-cache] [--print-meta]
 */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { DocumentConverter } from '../converters/document-converter.js';
import { out, die } from '../utils/console.js';

export interface ConvertFlags {
  out?: string;
  /** commander 的 --no-cache 存为 cache: false */
  cache?: boolean;
  printMeta?: boolean;
  check?: boolean;
}

export async function convertCommand(input: string, flags: ConvertFlags): Promise<void> {
  const converter = new DocumentConverter();

  if (flags.check) {
    const deps = converter.checkDependencies();
    if (deps.markitdownInstalled) {
      out.success('markitdown 已安装');
    } else {
      out.error('markitdown 未安装');
      out.info('安装提示:');
      out.log(deps.installHint);
      process.exit(1);
    }
    return;
  }

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
  out.info(`格式: ${result.result.metadata.format}  /  转换器: ${result.result.metadata.converter}  /  缓存: ${result.result.metadata.fromCache ? '命中' : 'miss'}`);
  if (result.result.metadata.durationMs) {
    out.info(`耗时: ${result.result.metadata.durationMs}ms`);
  }
  if (flags.printMeta) {
    out.log('\n元数据:');
    out.log(JSON.stringify(result.result.metadata, null, 2));
  }
}
