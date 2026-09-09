/**
 * JSON 文件读取 — 解析失败给出清晰错误而非裸堆栈
 */
import { readFileSync } from 'node:fs';
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
