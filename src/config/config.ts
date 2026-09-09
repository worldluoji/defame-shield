/**
 * 全局配置 — 读 .env (用户级) + dsh.config.json (项目级)
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface DshConfig {
  /** 当前项目根目录 (默认 cwd) */
  projectRoot: string;
  /** 案件数据目录, 相对 projectRoot, 默认 'data/cases' */
  casesDir: string;
  /** 输出目录, 相对案件目录, 默认 'outputs' */
  outputsDir: string;
  /** 用户署名 (起诉状/答辩状落款) */
  author: string;
  /** 是否启用 LLM 增强 (false 时所有 generate 走纯模板 draft 模式) */
  llmEnabled: boolean;
}

const DEFAULT_CONFIG: DshConfig = {
  projectRoot: process.cwd(),
  casesDir: 'data/cases',
  outputsDir: 'outputs',
  author: '',
  llmEnabled: true,
};

const CONFIG_FILENAME = 'dsh.config.json';

export function defaultConfig(projectRoot: string = process.cwd()): DshConfig {
  return { ...DEFAULT_CONFIG, projectRoot };
}

export function getConfigPath(projectRoot: string = process.cwd()): string {
  return join(projectRoot, CONFIG_FILENAME);
}

export function loadConfig(projectRoot: string = process.cwd()): DshConfig {
  const configPath = getConfigPath(projectRoot);
  if (!existsSync(configPath)) {
    return defaultConfig(projectRoot);
  }
  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<DshConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      projectRoot,
    };
  } catch (err) {
    throw new Error(
      `Failed to parse ${configPath}: ${(err as Error).message}\n` +
        `Delete the file and run \`dsh init\` again.`,
    );
  }
}

export function saveConfig(config: DshConfig, projectRoot: string = process.cwd()): void {
  const configPath = getConfigPath(projectRoot);
  mkdirSync(dirname(configPath), { recursive: true });
  const { projectRoot: _pr, ...persisted } = config;
  writeFileSync(configPath, JSON.stringify(persisted, null, 2) + '\n', 'utf-8');
}

export function getCasesDir(config: DshConfig): string {
  return join(config.projectRoot, config.casesDir);
}
