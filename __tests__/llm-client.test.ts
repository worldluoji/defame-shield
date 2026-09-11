/**
 * llm/client 重试行为测试 — mock 全局 fetch, 不发任何网络请求
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLLM } from '../src/llm/client';

const MSG = [{ role: 'user' as const, content: 'hi' }];

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function failResponse(status: number) {
  return {
    ok: false,
    status,
    text: async () => `server said ${status}`,
  };
}

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = savedKey;
  vi.unstubAllGlobals();
});

describe('callLLM 重试', () => {
  it('首次成功不重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('你好'));
    vi.stubGlobal('fetch', fetchMock);
    const r = await callLLM(MSG, { retryDelayMs: 0 });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('network_error 重试后成功', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(okResponse('恢复'));
    vi.stubGlobal('fetch', fetchMock);
    const r = await callLLM(MSG, { retryDelayMs: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe('恢复');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('5xx 重试 (默认 2 次), 第 3 次成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failResponse(503))
      .mockResolvedValueOnce(failResponse(503))
      .mockResolvedValueOnce(okResponse('最终成功'));
    vi.stubGlobal('fetch', fetchMock);
    const r = await callLLM(MSG, { retryDelayMs: 0 });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('429 视为可重试', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failResponse(429)).mockResolvedValueOnce(okResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);

    const r = await callLLM(MSG, { retryDelayMs: 0 });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('4xx (非 429) 不重试', async () => {
    const fetchMock = vi.fn(async () => failResponse(400) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const r = await callLLM(MSG, { retryDelayMs: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('http_error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('timeout 重试, 耗尽后错误信息注明已重试', async () => {
    const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = vi.fn().mockRejectedValue(abortErr());
    vi.stubGlobal('fetch', fetchMock);
    const r = await callLLM(MSG, { retries: 1, retryDelayMs: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('timeout');
    expect(r.error).toContain('已重试 1 次');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('missing_key 直接失败, 不发请求', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await callLLM(MSG);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('missing_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('透传 temperature/maxTokens 到请求体', async () => {
    let sent: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return okResponse('x') as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    await callLLM(MSG, { temperature: 0.9, maxTokens: 123, retryDelayMs: 0 });
    expect(sent?.temperature).toBe(0.9);
    expect(sent?.max_tokens).toBe(123);
  });
});
