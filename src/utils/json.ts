/**
 * JSON 文件读写 — 解析失败给出清晰错误而非裸堆栈
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { die } from './console.js';

export function readJsonFile<T = unknown>(path: string): T {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (e) {
    return die(`读取文件失败: ${path}\n  ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    return die(`JSON 格式错误: ${path}\n  ${(e as Error).message}`);
  }
}

/** 写 JSON 文件: 自动 mkdir -p, 2 空格缩进, 尾换行 */
export function writeJsonFile(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
