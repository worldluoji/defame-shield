/**
 * Microsoft MarkItDown CLI 适配器
 *
 * 包装 markitdown 命令行, 转为纯文本 markdown
 * - 输入: 文件路径
 * - 输出: markdown 字符串
 *
 * 重要: markitdown 是 Python 工具, 需要单独安装
 *   ./scripts/setup.sh  (推荐, 建 .venv 并按 requirements.txt 钉版本)
 *
 * 验证 markitdown 是否可用: spawn 'markitdown' --version
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** 检查 markitdown 是否已安装且可运行 (见 resolveMarkItDownBin) */
export function isMarkItDownInstalled(): boolean {
  return resolveMarkItDownBin() !== null;
}

/** 包根目录: src/converters 与 dist/src/converters 上跳 3 级都落到仓库根 */
function findPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

/** 返回所有可能的 markitdown 路径 (按优先级):
 *  1. `<包根>/.venv/bin/markitdown` (setup.sh 创建的项目 venv, 相对自身解析 — 全局 link / 异地 cwd 也能找到)
 *  2. `which markitdown` (PATH 全局)
 *  3. `<cwd>/.venv/bin/markitdown` (兼容: 在别的 defame-shield 检出目录里跑)
 *  4. `<cwd>/venv/bin/markitdown`
 *  5. `~/.venvs/defame-shield/bin/markitdown` (集中 venv)
 */
function findMarkItDownBinaries(): string[] {
  const candidates: string[] = [];
  const cwd = process.cwd();
  // 1) 包根 .venv 优先 — setup.sh 的权威位置, 压过 PATH 里可能损坏的全局安装
  candidates.push(join(findPackageRoot(), '.venv', 'bin', 'markitdown'));
  // 2) which PATH 查找
  try {
    const which = spawnSync('which', ['markitdown'], { stdio: 'pipe' });
    if (which.status === 0 && which.stdout) {
      candidates.push(which.stdout.toString().trim());
    }
  } catch {
    // ignore
  }
  // 3) 当前目录 .venv (uv 标准)
  candidates.push(join(cwd, '.venv', 'bin', 'markitdown'));
  // 4) 当前目录 venv
  candidates.push(join(cwd, 'venv', 'bin', 'markitdown'));
  // 5) 集中 venv
  candidates.push(join(homedir(), '.venvs', 'defame-shield', 'bin', 'markitdown'));
  return candidates;
}

/** 返回第一个"存在且能跑 --version"的 markitdown 路径 — 损坏 venv 里的断链/坏解释器不会误报已安装 */
function resolveMarkItDownBin(): string | null {
  for (const p of findMarkItDownBinaries()) {
    if (!existsSync(p)) continue;
    try {
      const v = spawnSync(p, ['--version'], { stdio: 'pipe', timeout: 10_000 });
      if (v.status === 0) return p;
    } catch {
      // 候选不可执行, 试下一个
    }
  }
  return null;
}

/** 安装提示 — markitdown 现为可选增强 (pdf/docx 有纯 Node 兜底) */
export const MARKITDOWN_INSTALL_HINT =
  'Microsoft MarkItDown 未安装 (pdf/docx 已自动走纯 Node 兜底; pptx/xlsx/html/表格需要它). 安装:\n' +
  '  ./scripts/setup.sh\n' +
  '或手动:\n' +
  '  pip install -r requirements.txt   # 与项目同版本\n' +
  '安装后验证: markitdown --help';

/** 调用 markitdown CLI 转换文件 → markdown */
export async function convertWithMarkItDown(
  filePath: string,
  opts: MarkItDownOptions = {},
): Promise<MarkItDownResult> {
  if (!existsSync(filePath)) {
    return { ok: false, error: `文件不存在: ${filePath}`, code: 'spawn_error' };
  }

  // 解析本地 .venv / PATH 中第一个可运行的二进制
  const markitdownBin = resolveMarkItDownBin();
  if (!markitdownBin) {
    return {
      ok: false,
      error: 'markitdown 命令未找到',
      code: 'not_installed',
      stderr: MARKITDOWN_INSTALL_HINT,
    };
  }

  // markitdown 0.1.8b1 不支持 "-o -" 输出到 stdout, 用临时文件
  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-markitdown-'));
  const tmpOutput = join(tmpDir, 'output.md');
  // 以 "-" 开头的路径会被 markitdown 当选项解析, 绝对化规避
  const safeInput = filePath.startsWith('-') ? resolve(filePath) : filePath;
  const args = [safeInput, '-o', tmpOutput];
  if (opts.enablePlugins) args.push('--use-plugins');
  if (opts.docintelEndpoint) args.push('-d', '-e', opts.docintelEndpoint);

  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 60_000;

  return new Promise((resolve) => {
    // markitdown 结果写入临时文件, stdout 仅为日志, 直接丢弃
    const child = spawn(markitdownBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      cleanupTmp(tmpDir);
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
