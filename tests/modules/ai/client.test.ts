import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleClient } from '../../../src/modules/ai/client.js';
import type { AiClientError } from '../../../src/modules/ai/client.js';

describe('OpenAI client error metadata', () => {
  it('preserves transient HTTP status for worker retry classification', async () => {
    const client = new OpenAiCompatibleClient(vi.fn().mockResolvedValue({ status: 429, json: () => Promise.resolve({ error: { message: 'busy' } }) }), true);
    await expect(client.request('GET', 'https://api.example/v1/models', 'key')).rejects.toMatchObject({ status: 429, retryable: true, message: 'busy' } satisfies Partial<AiClientError>);
  });
  it('marks deterministic provider rejections non-retryable', async () => {
    const client = new OpenAiCompatibleClient(vi.fn().mockResolvedValue({ status: 400, json: () => Promise.resolve({ error: { message: 'bad request' } }) }), true);
    await expect(client.request('GET', 'https://api.example/v1/models', 'key')).rejects.toMatchObject({ status: 400, retryable: false, message: 'bad request' } satisfies Partial<AiClientError>);
  });
  it('does not restart a full fallback request after the total timeout budget is exhausted', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 400, json: () => Promise.resolve({ error: { message: 'unknown parameter enable_thinking' } }) });
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValue(1_060);
    const client = new OpenAiCompatibleClient(transport, true);
    await expect(client.chat('https://api.example/v1', 'key', { model: 'vision' }, 50)).rejects.toMatchObject({ status: 400 });
    expect(transport).toHaveBeenCalledOnce();
    now.mockRestore();
  });
});
