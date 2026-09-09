/**
 * 文档转换器 — 统一接口, 多种输入格式 → markdown
 *
 * 设计原则:
 *  - 自动检测文件格式 (扩展名 + 魔数)
 *  - .md/.txt 直接 passthrough
 *  - .pdf/.docx/.pptx/.xlsx/.html 走 markitdown
 *  - 缓存: ~/.defame-shield/cache/<hash>.md, 命中条件: 文件 mtime + size 不变
 *  - markitdown 不可用时给清晰错误
 */

import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { detectFormat, isPassthrough, type SupportedFormat } from './format-detector.js';
import { convertWithMarkItDown, isMarkItDownInstalled, MARKITDOWN_INSTALL_HINT } from './markitdown-adapter.js';

export interface ConvertResult {
  markdown: string;
  metadata: {
    source: string;
    format: SupportedFormat;
    converter: 'passthrough' | 'markitdown' | 'cache';
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

/** 文档转换器 */
export class DocumentConverter {
  private cacheDir: string;

  constructor(opts: { cacheDir?: string; useCache?: boolean } = {}) {
    this.cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /** 检查依赖是否就绪 */
  checkDependencies(): { markitdownInstalled: boolean; installHint?: string } {
    const installed = isMarkItDownInstalled();
    return {
      markitdownInstalled: installed,
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
          error: `不支持的文件格式: ${filePath} (扩展名不在 MarkItDown 支持范围)`,
          code: 'unsupported_format',
        },
      };
    }

    // passthrough: md / txt — 先查缓存, 再读
    if (isPassthrough(format)) {
      if (useCache) {
        const cached = this.readCache(filePath, stat);
        if (cached) {
          return {
            ok: true,
            result: {
              markdown: cached,
              metadata: {
                source: filePath,
                format,
                converter: 'cache',
                fileSize: stat.size,
                mtime: stat.mtimeMs,
                convertedAt: new Date().toISOString(),
                fromCache: true,
              },
            },
          };
        }
      }
      const markdown = readFileSync(filePath, 'utf-8');
      // passthrough 也写缓存, 让二次调用走 cache 标记
      if (useCache) {
        this.writeCache(filePath, stat, markdown);
      }
      return {
        ok: true,
        result: {
          markdown,
          metadata: {
            source: filePath,
            format,
            converter: 'passthrough',
            fileSize: stat.size,
            mtime: stat.mtimeMs,
            convertedAt: new Date().toISOString(),
            fromCache: false,
          },
        },
      };
    }

    // 检查缓存
    if (useCache) {
      const cached = this.readCache(filePath, stat);
      if (cached) {
        return {
          ok: true,
          result: {
            markdown: cached,
            metadata: {
              source: filePath,
              format,
              converter: 'cache',
              fileSize: stat.size,
              mtime: stat.mtimeMs,
              convertedAt: new Date().toISOString(),
              fromCache: true,
            },
          },
        };
      }
    }

    // 调 markitdown
    const deps = this.checkDependencies();
    if (!deps.markitdownInstalled) {
      return {
        ok: false,
        error: {
          error: 'markitdown 未安装, 无法转换 PDF/Word 等格式',
          code: 'markitdown_not_installed',
          installHint: deps.installHint,
        },
      };
    }

    const result = await convertWithMarkItDown(filePath, { timeoutMs: 60_000 });
    if (!result.ok) {
      return {
        ok: false,
        error: {
          error: result.error,
          code: 'conversion_failed',
          installHint: result.code === 'not_installed' ? MARKITDOWN_INSTALL_HINT : undefined,
        },
      };
    }

    // 写缓存
    if (useCache) {
      this.writeCache(filePath, stat, result.markdown);
    }

    return {
      ok: true,
      result: {
        markdown: result.markdown,
        metadata: {
          source: filePath,
          format,
          converter: 'markitdown',
          fileSize: stat.size,
          mtime: stat.mtimeMs,
          convertedAt: new Date().toISOString(),
          durationMs: result.durationMs,
          fromCache: false,
        },
      },
    };
  }

  /** 计算缓存 key: sha256(path + size + mtime) */
  private cacheKey(filePath: string, stat: import('node:fs').Stats): string {
    const h = createHash('sha256');
    h.update(filePath);
    h.update(String(stat.size));
    h.update(String(Math.floor(stat.mtimeMs)));
    return h.digest('hex').slice(0, 32);
  }

  /** 读缓存 */
  private readCache(filePath: string, stat: import('node:fs').Stats): string | null {
    const key = this.cacheKey(filePath, stat);
    const cachePath = join(this.cacheDir, `${key}.md`);
    if (!existsSync(cachePath)) return null;
    return readFileSync(cachePath, 'utf-8');
  }

  /** 写缓存 */
  private writeCache(filePath: string, stat: import('node:fs').Stats, markdown: string): void {
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
