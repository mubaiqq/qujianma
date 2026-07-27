import { describe, expect, it, vi } from 'vitest';
/* eslint-disable @typescript-eslint/require-await */
import { AiProviderService, extractJsonObject, maskApiKey, normalizeOpenAiBaseUrl, openAiEndpoint, validateAiBaseUrl } from '../../../src/modules/ai/domain.js';

describe('OpenAI compatible configuration', () => {
  it('normalizes endpoints, masks keys, and extracts strict objects', () => {
    expect(normalizeOpenAiBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1');
    expect(openAiEndpoint('https://api.example.com/v1/', '/models')).toBe('https://api.example.com/v1/models');
    expect(maskApiKey('sk-123456abcdef')).toBe('sk-1••••cdef');
    expect(extractJsonObject('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(() => extractJsonObject('prefix {"ok":true} suffix')).toThrow('模型必须只返回JSON对象');
  });

  it('blocks SSRF destinations including DNS resolved private addresses', async () => {
    await expect(validateAiBaseUrl('http://127.0.0.1/v1')).resolves.toBe(false);
    await expect(validateAiBaseUrl('http://[::1]/v1')).resolves.toBe(false);
    await expect(validateAiBaseUrl('https://api.example.com/v1', { lookup: async () => ['93.184.216.34'] })).resolves.toBe(true);
    await expect(validateAiBaseUrl('https://evil.example/v1', { lookup: async () => ['10.0.0.4'] })).resolves.toBe(false);
    await expect(validateAiBaseUrl('ftp://api.example.com')).resolves.toBe(false);
  });
});

describe('AiProviderService legacy actions', () => {
  it('keeps old ciphertext when an update omits the key and first provider becomes active', async () => {
    const repository = {
      list: vi.fn().mockResolvedValue([]), find: vi.fn().mockResolvedValue({ id: 2, user_id: 7, api_key_ciphertext: 'old', api_key_hint: 'hint', base_url: 'https://api.example/v1', model_name: 'm', is_active: 0 }),
      count: vi.fn().mockResolvedValue(0), save: vi.fn().mockResolvedValue(undefined), select: vi.fn(), delete: vi.fn(), status: vi.fn(), updateTest: vi.fn(), active: vi.fn(),
    };
    const service = new AiProviderService(repository, { encrypt: (v) => `enc:${v}`, decrypt: () => 'secret', validateUrl: async () => true, client: { fetchModels: vi.fn(), test: vi.fn() } });
    await service.save(7, { display_name: '配置', base_url: 'https://api.example/v1/', model_name: 'm', api_key: 'new' });
    expect(repository.save).toHaveBeenCalledWith(7, expect.objectContaining({ apiKeyCiphertext: 'enc:new', isActive: true }));
    await service.save(7, { id: 2, display_name: '配置2', base_url: 'https://api.example/v1/', model_name: 'm2' });
    expect(repository.save).toHaveBeenLastCalledWith(7, expect.objectContaining({ id: 2, apiKeyCiphertext: 'old', apiKeyHint: 'hint' }));
  });

  it('fetches models with the decrypted stored key and reports test failures', async () => {
    const repository = {
      list: vi.fn(), find: vi.fn().mockResolvedValue({ id: 2, user_id: 7, api_key_ciphertext: 'cipher', api_key_hint: 'hint', base_url: 'https://api.example/v1', model_name: 'm', is_active: 1 }),
      count: vi.fn(), save: vi.fn(), select: vi.fn(), delete: vi.fn(), status: vi.fn(), updateTest: vi.fn(), active: vi.fn(),
    };
    const client = { fetchModels: vi.fn().mockResolvedValue(['z', 'a']), test: vi.fn().mockRejectedValue(new Error('bad model')) };
    const service = new AiProviderService(repository, { encrypt: String, decrypt: () => 'plain-key', validateUrl: async () => true, client });
    await expect(service.fetchModels(7, { id: 2 })).resolves.toMatchObject({ status: 200, body: { code: 0, data: { models: ['z', 'a'] } } });
    expect(client.fetchModels).toHaveBeenCalledWith('https://api.example/v1', 'plain-key');
    await expect(service.test(7, { id: 2 })).resolves.toMatchObject({ status: 422, body: { code: 1, message: '测试失败：bad model' } });
    expect(repository.updateTest).toHaveBeenCalledWith(7, 2, 'failed', 'bad model');
  });
});
