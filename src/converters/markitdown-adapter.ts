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
import { existsSync } from 'node:fs';

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

/** 检查 markitdown 是否已安装 */
export function isMarkItDownInstalled(): boolean {
  try {
    const which = spawnSync('which', ['markitdown'], { stdio: 'ignore' });
    return which.status === 0;
  } catch {
    return false;
  }
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

  const args = [filePath, '-o', '-']; // 输出到 stdout
  if (opts.enablePlugins) args.push('--use-plugins');
  if (opts.docintelEndpoint) args.push('-d', '-e', opts.docintelEndpoint);

  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 60_000;

  return new Promise((resolve) => {
    const child = spawn('markitdown', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
        resolve({
          ok: false,
          error: `markitdown 超时 (${timeoutMs}ms), 已 kill`,
          code: 'timeout',
          stderr,
        });
        return;
      }
      if (code !== 0) {
        resolve({
          ok: false,
          error: `markitdown 退出码 ${code}`,
          code: 'non_zero_exit',
          stderr: stderr || '(无 stderr 输出)',
        });
        return;
      }
      if (!stdout.trim()) {
        resolve({
          ok: false,
          error: 'markitdown 转换成功但输出为空',
          code: 'no_output',
          stderr,
        });
        return;
      }
      resolve({ ok: true, markdown: stdout, durationMs });
    });
  });
}
