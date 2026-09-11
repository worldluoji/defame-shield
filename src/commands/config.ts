/**
 * dsh config — 显示 / 修改配置
 */
import { loadConfig, saveConfig } from '../config/config.js';
import { out } from '../utils/console.js';

export function configShowCommand(): void {
  const c = loadConfig();
  out.info('当前配置:');
  out.log(JSON.stringify(c, null, 2));
}

export function configSetCommand(key: string, value: string): void {
  const c = loadConfig();
  const allowed = ['author', 'llmEnabled', 'casesDir', 'outputsDir'];
  if (!allowed.includes(key)) {
    out.error(`不支持的 key: ${key}`);
    out.dim(`支持的: ${allowed.join(', ')}`);
    process.exit(1);
  }
  let parsed: unknown = value;
  if (key === 'llmEnabled') {
    parsed = value === 'true' || value === '1';
  }
  (c as unknown as Record<string, unknown>)[key] = parsed;
  saveConfig(c);
  out.success(`已设置 ${key} = ${String(parsed)}`);
}
