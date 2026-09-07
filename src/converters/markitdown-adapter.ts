/**
 * Microsoft MarkItDown CLI 适配器
 *
 * 包装 markitdown 命令行, 转为纯文本 markdown
 * - 输入: 文件路径
 * - 输出: markdown 字符串
 *
 * 重要: markitdown 是 Python 工具, 需要单独安装
 *   pip install 'markitdown[pdf,docx]'
 *   或 pip install 'markitdown[all]'  (含 OCR/音频等)
 *
 * 验证 markitdown 是否可用: spawn 'markitdown' --version
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MarkItDownOptions {
  /** 超时 ms, 默认 60s */
  timeoutMs?: number;
  /** 启用插件 (实验性) */
  enablePlugins?: boolean;
  /** Document Intelligence endpoint (Azure, 可选) */
  docintelEndpoint?: string;
}

export interface MarkItDownSuccess {
  ok: true;
  markdown: string;
  durationMs: number;
}

export interface MarkItDownError {
  ok: false;
  error: string;
  code: 'not_installed' | 'timeout' | 'spawn_error' | 'non_zero_exit' | 'no_output';
  stderr?: string;
}

export type MarkItDownResult = MarkItDownSuccess | MarkItDownError;

/** 检查 markitdown 是否已安装 — 多级查找
 *  1. `which markitdown` (PATH)
 *  2. `<cwd>/.venv/bin/markitdown` (项目本地 uv venv)
 *  3. `<cwd>/venv/bin/markitdown` (项目本地 venv)
 *  4. `~/.venvs/defame-shield/bin/markitdown` (集中 venv)
 *  5. `~/Library/Caches/markitdown` (macOS 缓存, 备用)
 */
export function isMarkItDownInstalled(): boolean {
  for (const p of findMarkItDownBinaries()) {
    try {
      if (existsSync(p)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/** 返回所有可能的 markitdown 路径 (按优先级) */
function findMarkItDownBinaries(): string[] {
  const candidates: string[] = [];
  const cwd = process.cwd();
  // 1) which PATH 查找
  try {
    const which = spawnSync('which', ['markitdown'], { stdio: 'pipe' });
    if (which.status === 0 && which.stdout) {
      candidates.push(which.stdout.toString().trim());
    }
  } catch {
    // ignore
  }
  // 2) 项目本地 .venv (uv 标准)
  candidates.push(join(cwd, '.venv', 'bin', 'markitdown'));
  // 3) 项目本地 venv
  candidates.push(join(cwd, 'venv', 'bin', 'markitdown'));
  // 4) 集中 venv
  candidates.push(join(homedir(), '.venvs', 'defame-shield', 'bin', 'markitdown'));
  return candidates;
}

/** 找第一个存在的 markitdown 路径, 用于 spawn */
function findMarkItDownPath(): string | null {
  for (const p of findMarkItDownBinaries()) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** 安装提示 */
export const MARKITDOWN_INSTALL_HINT =
  'Microsoft MarkItDown 未安装. 请运行:\n' +
  '  pip install "markitdown[pdf,docx]"\n' +
  '或全功能版 (含 OCR):\n' +
  '  pip install "markitdown[all]"\n' +
  '或用 brew (macOS):\n' +
  '  brew install markitdown\n' +
  '安装后验证: markitdown --help';

/** 调用 markitdown CLI 转换文件 → markdown */
export async function convertWithMarkItDown(
  filePath: string,
  opts: MarkItDownOptions = {},
): Promise<MarkItDownResult> {
  if (!existsSync(filePath)) {
    return { ok: false, error: `文件不存在: ${filePath}`, code: 'spawn_error' };
  }

  // markitdown 0.1.8b1 不支持 "-o -" 输出到 stdout, 用临时文件
  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-markitdown-'));
  const tmpOutput = join(tmpDir, 'output.md');
  const args = [filePath, '-o', tmpOutput];
  if (opts.enablePlugins) args.push('--use-plugins');
  if (opts.docintelEndpoint) args.push('-d', '-e', opts.docintelEndpoint);

  // 优先用 findMarkItDownPath() 找本地 .venv 的二进制
  const markitdownBin = findMarkItDownPath();
  if (!markitdownBin) {
    return {
      ok: false,
      error: 'markitdown 命令未找到',
      code: 'not_installed',
      stderr: MARKITDOWN_INSTALL_HINT,
    };
  }

  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 60_000;

  return new Promise((resolve) => {
    const child = spawn(markitdownBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({
          ok: false,
          error: 'markitdown 命令未找到',
          code: 'not_installed',
          stderr: MARKITDOWN_INSTALL_HINT,
        });
      } else {
        resolve({
          ok: false,
          error: `spawn 失败: ${err.message}`,
          code: 'spawn_error',
          stderr,
        });
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (killed) {
        cleanupTmp(tmpDir);
        resolve({
          ok: false,
          error: `markitdown 超时 (${timeoutMs}ms), 已 kill`,
          code: 'timeout',
          stderr,
        });
        return;
      }
      if (code !== 0) {
        cleanupTmp(tmpDir);
        resolve({
          ok: false,
          error: `markitdown 退出码 ${code}`,
          code: 'non_zero_exit',
          stderr: stderr || '(无 stderr 输出)',
        });
        return;
      }
      // 读临时文件
      let markdown = '';
      try {
        markdown = readFileSync(tmpOutput, 'utf-8');
      } catch (e) {
        cleanupTmp(tmpDir);
        resolve({
          ok: false,
          error: `markitdown 退出成功但读取输出文件失败: ${(e as Error).message}`,
          code: 'no_output',
          stderr,
        });
        return;
      }
      cleanupTmp(tmpDir);
      if (!markdown.trim()) {
        resolve({
          ok: false,
          error: 'markitdown 转换成功但输出为空',
          code: 'no_output',
          stderr,
        });
        return;
      }
      resolve({ ok: true, markdown, durationMs });
    });
  });
}

/** 清理临时目录 */
function cleanupTmp(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
