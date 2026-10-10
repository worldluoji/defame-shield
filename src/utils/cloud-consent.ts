/**
 * 云端数据外发确认 — 律师对当事人信息负保密义务。
 * 任何走 LLM 的命令在发请求前必须先过本确认; 用户拒绝 → 调用方降级 draft/rule 离线路径
 * (数据不出本机, 与"双模式强制"不变量一致)。
 */
import inquirer from 'inquirer';
import { loadConfig, saveConfig } from '../config/config.js';
import { AI_MODELS } from '../llm/client.js';
import { out } from './console.js';

export function resolveProviderName(provider?: string): string {
  const name = provider || (process.env.MODEL_PROVIDER as string) || 'deepseek';
  return name;
}

function describeEndpoint(name: string): string {
  return (AI_MODELS as Record<string, { endpoint: string }>)[name]?.endpoint ?? '(未知端点)';
}

/** true = 允许云端调用; false = 用户拒绝, 调用方必须降级到 draft/rule */
export async function confirmCloudDisclosure(provider?: string): Promise<boolean> {
  if (loadConfig().llmCloudConsent === true) return true;
  const name = resolveProviderName(provider);

  if (!process.stdin.isTTY) {
    out.warn(
      `AI 模式: 文书/起诉状全文将发送至 ${name} 云端 (${describeEndpoint(name)})。` +
        `非交互环境无法弹出确认 — 请确认已获当事人同意; 担心外发请用 --draft / --mode rule 离线模式。`,
    );
    return true;
  }

  const { choice } = await inquirer.prompt<{ choice: string }>([
    {
      type: 'list',
      name: 'choice',
      message:
        `⚠️ AI 增强需要把文书/起诉状全文发送到 ${name} 云端 (${describeEndpoint(name)})。\n` +
        `   律师对当事人信息负保密义务, 请确认已获当事人同意:`,
      choices: [
        '同意 (记住此选择)',
        '同意 (仅本次)',
        '不同意 → 改用离线 draft/rule 模板模式 (数据不出本机)',
      ],
    },
  ]);

  if (choice.startsWith('不同意')) {
    out.info('已拒绝云端发送 — 本次改走离线模板路径 (文书质量依赖反点策略库与事实回填)。');
    return false;
  }
  if (choice.includes('记住')) {
    const c = loadConfig();
    c.llmCloudConsent = true;
    saveConfig(c);
    out.info('已记住: 后续 AI 调用不再询问 (重置: dsh config set llmCloudConsent false)');
  }
  return true;
}
