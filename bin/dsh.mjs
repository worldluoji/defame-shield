#!/usr/bin/env node
// dsh 入口: 优先跑 dist/ 编译产物, 否则用 tsx 直跑 .ts 源码 (开发模式)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const distCli = join(root, 'dist', 'src', 'cli.js');
const tsxBin = join(root, 'node_modules', '.bin', 'tsx');
const cliTs = join(root, 'src', 'cli.ts');

let cmd;
let args;
if (existsSync(distCli)) {
  cmd = process.execPath;
  args = [distCli, ...process.argv.slice(2)];
} else if (existsSync(tsxBin)) {
  cmd = tsxBin;
  args = [cliTs, ...process.argv.slice(2)];
} else {
  console.error('defame-shield 启动失败: 既没有 dist/ 编译产物, 也没有安装 tsx.');
  console.error('开发环境请运行: pnpm install (开发), 或 pnpm install && pnpm build');
  process.exit(1);
}

const child = spawn(cmd, args, { stdio: 'inherit', cwd: process.cwd() });
child.on('error', (err) => {
  console.error(`启动失败: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : code ?? 0);
});
