/**
 * 极简 .env 解析 — 读 KEY=VALUE 行，跳过注释和空行。
 * 不引 dotenv 依赖（MVP 阶段，够用）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ENV_FILES = ['.env.local', '.env'];

export function loadEnvFile(projectRoot: string = process.cwd()): void {
  for (const filename of ENV_FILES) {
    const envPath = join(projectRoot, filename);
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

export function getEnv(key: string, fallback?: string): string | undefined {
  const v = process.env[key];
  if (v !== undefined && v !== '') return v;
  return fallback;
}

export function getEnvOrThrow(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    throw new Error(
      `Missing required env: ${key}\n` +
        `Set it in .env.local (copy from .env.example) before running.`,
    );
  }
  return v;
}

export function getEnvBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}
