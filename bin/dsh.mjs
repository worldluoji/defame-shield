#!/usr/bin/env node
// 用 tsx 加载 .ts 源码
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// 转发给 tsx 跑 src/cli.ts
const tsxBin = join(root, 'node_modules', '.bin', 'tsx');
const cliTs = join(root, 'src', 'cli.ts');

const child = spawn(tsxBin, [cliTs, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd(),
});
child.on('exit', (code) => process.exit(code ?? 0));
