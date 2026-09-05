/**
 * dsh init — 初始化项目（创建 dsh.config.json + 案件目录 + .env.local 提示）
 */
import { existsSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import inquirer from 'inquirer';
import { loadConfig, saveConfig, type DshConfig } from '../config/config.js';
import { out, die } from '../utils/console.js';

export async function initCommand(): Promise<void> {
  const root = process.cwd();
  const existing = loadConfig(root);

  if (existsSync(join(root, 'dsh.config.json'))) {
    const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'dsh.config.json 已存在, 是否覆盖?',
        default: false,
      },
    ]);
    if (!overwrite) {
      out.info('已取消');
      return;
    }
  }

  const answers = await inquirer.prompt<{ author: string; llmEnabled: boolean }>([
    {
      type: 'input',
      name: 'author',
      message: '你的署名 (起诉状/答辩状落款用):',
      default: existing.author || '',
    },
    {
      type: 'confirm',
      name: 'llmEnabled',
      message: '是否启用 LLM 增强 (生成质量更好, 但需要 API key)?',
      default: existing.llmEnabled ?? true,
    },
  ]);

  const config: DshConfig = {
    ...existing,
    projectRoot: root,
    author: answers.author,
    llmEnabled: answers.llmEnabled,
  };
  saveConfig(config, root);
  out.success(`已创建 dsh.config.json`);

  // 案件目录
  const casesDir = join(root, config.casesDir);
  mkdirSync(casesDir, { recursive: true });
  out.success(`案件目录: ${casesDir}`);

  // .env.local
  if (!existsSync(join(root, '.env.local'))) {
    if (existsSync(join(root, '.env.example'))) {
      copyFileSync(join(root, '.env.example'), join(root, '.env.local'));
      out.success('已创建 .env.local (从 .env.example 复制)');
      out.warn('请编辑 .env.local 填入你的 API key');
    } else {
      die('.env.example 不存在, 请先创建');
    }
  } else {
    out.info('.env.local 已存在, 跳过');
  }

  out.success('初始化完成! 接下来:');
  out.dim('  1. 编辑 .env.local 填入 API key (DEEPSEEK_API_KEY 或 MINIMAX_API_KEY)');
  out.dim('  2. dsh case new <id>       创建案件');
  out.dim('  3. dsh generate letter --case <id>   生成律师函');
}
