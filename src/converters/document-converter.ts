/**
 * 文档转换器 — 统一接口, 多种输入格式 → markdown
 *
 * 设计原则:
 *  - 自动检测文件格式 (扩展名 + 魔数)
 *  - .md/.txt 直接 passthrough
 *  - .pdf/.docx: markitdown 优先; 未安装(或 --native)走纯 Node 兜底 (mammoth / pdf.js)
 *  - .pptx/.xlsx/.html 仅 markitdown 支持
 *  - 缓存: ~/.defame-shield/cache/<hash>.md, 命中条件: 文件 mtime + size 不变
 *  - markitdown 与 native 都不可用/失败时给清晰错误
 */

import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { detectFormat, isPassthrough, type SupportedFormat } from './format-detector.js';
import { convertWithMarkItDown, isMarkItDownInstalled, MARKITDOWN_INSTALL_HINT } from './markitdown-adapter.js';
import { convertDocxNative, convertPdfNative, isNativeSupported, SCANNED_PDF_GUIDANCE } from './native-converters.js';

/**
 * 可见文字强度: 去掉空白/图片链接语法/排版符号后剩余字符数。
 * 接近 0 = 扫描版或空壳内容, 不应静默通过 (起诉状不可能是两三行)。
 */
export function visibleTextCount(md: string): number {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#>*|_\-`\s]/g, '')
    .length;
}

/** 低于此字数视为"疑似扫描件/空壳", 转换成功但给出警告 */
export const LOW_TEXT_WARN_THRESHOLD = 30;

export type ConverterKind = 'passthrough' | 'markitdown' | 'cache' | 'native-docx' | 'native-pdf';

export interface ConvertResult {
  markdown: string;
  metadata: {
    source: string;
    format: SupportedFormat;
    converter: ConverterKind;
    fileSize: number;
    mtime: number;
    pageCount?: number;
    convertedAt: string;
    durationMs?: number;
    /** 是否来自缓存 */
    fromCache: boolean;
  };
}

export interface ConvertError {
  error: string;
  code: 'not_found' | 'unsupported_format' | 'markitdown_not_installed' | 'conversion_failed';
  installHint?: string;
}

export type ConvertOutcome = { ok: true; result: ConvertResult } | { ok: false; error: ConvertError };

/** 默认缓存目录 */
const DEFAULT_CACHE_DIR = join(homedir(), '.defame-shield', 'cache');

export interface DocumentConverterOptions {
  cacheDir?: string;
  useCache?: boolean;
  /** 强制纯 Node 路径 (仅 pdf/docx 生效; 其余格式仍要求 markitdown) */
  preferNative?: boolean;
}

/** 文档转换器 */
export class DocumentConverter {
  private cacheDir: string;
  private preferNative: boolean;

  constructor(opts: DocumentConverterOptions = {}) {
    this.cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
    this.preferNative = opts.preferNative ?? false;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /** 检查依赖是否就绪 */
  checkDependencies(): { markitdownInstalled: boolean; nativeAvailable: true; installHint?: string } {
    const installed = isMarkItDownInstalled();
    return {
      markitdownInstalled: installed,
      nativeAvailable: true,
      installHint: installed ? undefined : MARKITDOWN_INSTALL_HINT,
    };
  }

  /** 转换入口 */
  async convert(filePath: string, useCache: boolean = true): Promise<ConvertOutcome> {
    if (!existsSync(filePath)) {
      return {
        ok: false,
        error: { error: `文件不存在: ${filePath}`, code: 'not_found' },
      };
    }

    const stat = statSync(filePath);
    const format = detectFormat(filePath);

    if (format === 'unsupported') {
      return {
        ok: false,
        error: {
          error: `不支持的文件格式: ${filePath} (扩展名不在支持范围)`,
          code: 'unsupported_format',
        },
      };
    }

    // passthrough: md / txt — 先查缓存, 再读
    if (isPassthrough(format)) {
      if (useCache) {
        const cached = this.readCache(filePath, stat);
        if (cached) {
          return { ok: true, result: this.buildResult(filePath, stat, format, cached, 'cache', { fromCache: true }) };
        }
      }
      const markdown = readFileSync(filePath, 'utf-8');
      // passthrough 也写缓存, 让二次调用走 cache 标记
      if (useCache) {
        this.writeCache(filePath, stat, markdown);
      }
      return { ok: true, result: this.buildResult(filePath, stat, format, markdown, 'passthrough', { fromCache: false }) };
    }

    // 检查缓存
    if (useCache) {
      const cached = this.readCache(filePath, stat);
      if (cached) {
        return { ok: true, result: this.buildResult(filePath, stat, format, cached, 'cache', { fromCache: true }) };
      }
    }

    // 强制纯 Node: pdf/docx 直接走兜底路径
    if (this.preferNative && isNativeSupported(format)) {
      return this.convertNative(filePath, format, stat, useCache);
    }

    // 非 pdf/docx (pptx/xlsx/html) 只有 markitdown 支持
    const deps = this.checkDependencies();
    if (!deps.markitdownInstalled && !isNativeSupported(format)) {
      return {
        ok: false,
        error: {
          error: `markitdown 未安装, 无法转换 ${format} 格式`,
          code: 'markitdown_not_installed',
          installHint: deps.installHint,
        },
      };
    }

    // markitdown 优先 (表格/结构保留质量更好); 未安装时 pdf/docx 走纯 Node 兜底
    if (deps.markitdownInstalled) {
      const result = await convertWithMarkItDown(filePath, { timeoutMs: 60_000 });
      if (result.ok) {
        // markitdown "成功"但只剩图片引用 = 扫描版, 报错而非静默产出空壳 md
        if (visibleTextCount(result.markdown) === 0) {
          return {
            ok: false,
            error: { error: SCANNED_PDF_GUIDANCE, code: 'conversion_failed' },
          };
        }
        if (useCache) {
          this.writeCache(filePath, stat, result.markdown);
        }
        return {
          ok: true,
          result: this.buildResult(filePath, stat, format, result.markdown, 'markitdown', {
            durationMs: result.durationMs,
            fromCache: false,
          }),
        };
      }
      // markitdown 存在但失败 (超时/崩溃): pdf/docx 降级到纯 Node, 其余报错
      if (!isNativeSupported(format)) {
        return {
          ok: false,
          error: {
            error: result.error,
            code: 'conversion_failed',
            installHint: result.code === 'not_installed' ? MARKITDOWN_INSTALL_HINT : undefined,
          },
        };
      }
      // 不写缓存: 降级结果可能是简化版, markitdown 恢复后应允许重新转换
      const native = await this.convertNative(filePath, format, stat, false);
      if (!native.ok) {
        native.error.error = `markitdown 失败 (${result.error}); 纯 Node 兜底也失败: ${native.error.error}`;
      }
      return native;
    }

    // markitdown 未安装 + pdf/docx → 纯 Node 兜底
    if (isNativeSupported(format)) {
      return this.convertNative(filePath, format, stat, useCache);
    }
    return {
      ok: false,
      error: {
        error: `markitdown 未安装, 无法转换 ${format} 格式`,
        code: 'markitdown_not_installed',
        installHint: MARKITDOWN_INSTALL_HINT,
      },
    };
  }

  /** 纯 Node 兜底: docx → mammoth, pdf(文字版) → pdf.js */
  private async convertNative(
    filePath: string,
    format: 'pdf' | 'docx',
    stat: Stats,
    useCache: boolean,
  ): Promise<ConvertOutcome> {
    const r = format === 'pdf' ? await convertPdfNative(filePath) : await convertDocxNative(filePath);
    if (!r.ok) {
      return {
        ok: false,
        error: {
          error: r.error,
          code: 'conversion_failed',
          // 提取为空 (扫描版) 时装 markitdown 也没用, 不给误导性安装提示
          installHint: r.code === 'no_output' ? undefined : MARKITDOWN_INSTALL_HINT,
        },
      };
    }
    if (useCache) {
      this.writeCache(filePath, stat, r.markdown);
    }
    return {
      ok: true,
      result: this.buildResult(filePath, stat, format, r.markdown, format === 'pdf' ? 'native-pdf' : 'native-docx', {
        durationMs: r.durationMs,
        pageCount: r.pageCount,
        fromCache: false,
      }),
    };
  }

  /** 组装统一的结果元数据 */
  private buildResult(
    filePath: string,
    stat: Stats,
    format: SupportedFormat,
    markdown: string,
    converter: ConverterKind,
    extra: { durationMs?: number; pageCount?: number; fromCache: boolean },
  ): ConvertResult {
    return {
      markdown,
      metadata: {
        source: filePath,
        format,
        converter,
        fileSize: stat.size,
        mtime: stat.mtimeMs,
        pageCount: extra.pageCount,
        convertedAt: new Date().toISOString(),
        durationMs: extra.durationMs,
        fromCache: extra.fromCache,
      },
    };
  }

  /** 计算缓存 key: sha256(path + size + mtime) */
  private cacheKey(filePath: string, stat: Stats): string {
    const h = createHash('sha256');
    h.update(filePath);
    h.update(String(stat.size));
    h.update(String(Math.floor(stat.mtimeMs)));
    return h.digest('hex').slice(0, 32);
  }

  /** 读缓存 */
  private readCache(filePath: string, stat: Stats): string | null {
    const key = this.cacheKey(filePath, stat);
    const cachePath = join(this.cacheDir, `${key}.md`);
    if (!existsSync(cachePath)) return null;
    return readFileSync(cachePath, 'utf-8');
  }

  /** 写缓存 */
  private writeCache(filePath: string, stat: Stats, markdown: string): void {
    const key = this.cacheKey(filePath, stat);
    const cachePath = join(this.cacheDir, `${key}.md`);
    try {
      writeFileSync(cachePath, markdown, 'utf-8');
    } catch {
      // 缓存写失败不影响主流程
    }
  }

  /** 清空缓存 */
  clearCache(): { removed: number } {
    if (!existsSync(this.cacheDir)) return { removed: 0 };
    const files = readdirSync(this.cacheDir).filter((f) => f.endsWith('.md'));
    let removed = 0;
    for (const f of files) {
      try {
        unlinkSync(join(this.cacheDir, f));
        removed++;
      } catch {
        // 忽略
      }
    }
    return { removed };
  }
}
