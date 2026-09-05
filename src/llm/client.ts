/**
 * LLM 客户端 — 调 deepseek / minimax (OpenAI 兼容协议)
 * MVP：单轮 + 同步返回，失败抛带分类的错
 */

export type ModelProvider = 'deepseek' | 'minimax';

export interface ModelConfig {
  endpoint: string;
  model: string;
  apiKeyEnv: string;
  defaultTimeoutMs: number;
}

export const AI_MODELS: Record<ModelProvider, ModelConfig> = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultTimeoutMs: 90_000,
  },
  minimax: {
    endpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
    model: 'MiniMax-M3',
    apiKeyEnv: 'MINIMAX_API_KEY',
    defaultTimeoutMs: 90_000,
  },
};

export const DEFAULT_MODEL: ModelProvider = 'deepseek';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMSuccess {
  ok: true;
  text: string;
  provider: ModelProvider;
  model: string;
  elapsedMs: number;
}

export interface LLMError {
  ok: false;
  error: string;
  code: 'missing_key' | 'unknown_provider' | 'http_error' | 'network_error' | 'parse_error' | 'timeout';
  provider?: ModelProvider;
}

export type LLMResult = LLMSuccess | LLMError;

/**
 * 调 LLM。返回 LLMResult 而不是 throw — 让上层自己决定怎么显示。
 */
export async function callLLM(
  messages: LLMMessage[],
  opts: { provider?: ModelProvider; temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<LLMResult> {
  const provider = opts.provider ?? ((process.env.MODEL_PROVIDER as ModelProvider) || DEFAULT_MODEL);
  if (!(provider in AI_MODELS)) {
    return {
      ok: false,
      code: 'unknown_provider',
      error: `Unknown MODEL_PROVIDER="${provider}". Known: ${Object.keys(AI_MODELS).join(', ')}`,
    };
  }
  const cfg = AI_MODELS[provider];
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) {
    return {
      ok: false,
      code: 'missing_key',
      provider,
      error: `Missing API key: env ${cfg.apiKeyEnv} not set. Set in .env.local or export it.`,
    };
  }

  const timeoutMs = opts.timeoutMs ?? cfg.defaultTimeoutMs;
  const body = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? 0.4,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  };

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        code: 'http_error',
        provider,
        error: `HTTP ${res.status}: ${text.slice(0, 500)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      return {
        ok: false,
        code: 'parse_error',
        provider,
        error: 'LLM response missing choices[0].message.content',
      };
    }
    return {
      ok: true,
      text,
      provider,
      model: cfg.model,
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    clearTimeout(timer);
    const e = err as Error;
    if (e.name === 'AbortError') {
      return { ok: false, code: 'timeout', provider, error: `LLM call timed out after ${timeoutMs}ms` };
    }
    return { ok: false, code: 'network_error', provider, error: e.message };
  }
}
