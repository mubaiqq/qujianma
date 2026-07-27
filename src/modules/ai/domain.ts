import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
/* eslint-disable @typescript-eslint/no-base-to-string */

export interface AiProviderRow {
  id: number; user_id: number; display_name?: string; base_url: string; api_key_ciphertext: string;
  api_key_hint: string; model_name: string; is_active: number; last_test_status?: string;
  last_test_message?: string; last_tested_at?: Date | string | null; created_at?: Date | string;
}
export interface PublicAiProvider { id: number; display_name: string; base_url: string; api_key_hint: string; model_name: string; is_active: number; last_test_status: string; last_test_message: string; last_tested_at: Date | string | null; created_at: Date | string }
export interface SaveAiProvider { id: number; displayName: string; baseUrl: string; apiKeyCiphertext: string; apiKeyHint: string; modelName: string; isActive: boolean }
export interface AiStatus { counts: { pending_count: number | string | null; failed_count: number | string | null; no_config_count: number | string | null; timeout_retry_count?: number | string | null }; provider: { display_name: string; model_name: string } | null }
export interface AiProviderRepository {
  list(userId: number): Promise<PublicAiProvider[]>; find(userId: number, id: number): Promise<AiProviderRow | null>;
  count(userId: number): Promise<number>; save(userId: number, provider: SaveAiProvider): Promise<void>;
  select(userId: number, id: number): Promise<void>; delete(userId: number, id: number): Promise<void>;
  updateTest(userId: number, id: number, status: 'success' | 'failed', message: string): Promise<void>;
  status(userId: number): Promise<AiStatus>; active(userId: number): Promise<AiProviderRow | null>;
}
export interface OpenAiClient { fetchModels(base: string, key: string): Promise<string[]>; test(base: string, key: string, model: string): Promise<void> }
export class AiProviderNotFoundError extends Error {}
export class ActiveAiProviderDeleteError extends Error {}

export const normalizeOpenAiBaseUrl = (url: string): string => url.trim().replace(/\/+$/u, '');
export const openAiEndpoint = (base: string, path: string): string => `${normalizeOpenAiBaseUrl(base)}/${path.replace(/^\/+/, '')}`;
export function maskApiKey(key: string): string { const value = key.trim(); return value.length <= 8 ? '•'.repeat(Math.max(4, value.length)) : `${value.slice(0, 4)}••••${value.slice(-4)}`; }
export function extractJsonObject(content: string): Record<string, unknown> {
  const stripped = content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  let parsed: unknown;
  try { parsed = JSON.parse(stripped); } catch { throw new Error(stripped.startsWith('{') ? '模型返回的JSON格式错误' : '模型必须只返回JSON对象'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型返回结构无效');
  return parsed as Record<string, unknown>;
}
function blockedIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number); const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b !== undefined && b >= 64 && b <= 127) || (a !== undefined && a >= 224);
}
function blockedIp(ip: string): boolean {
  if (isIP(ip) === 4) return blockedIpv4(ip);
  if (isIP(ip) !== 6) return true;
  const value = ip.toLowerCase().split('%')[0] ?? '';
  if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/u.test(value)) return true;
  const mapped = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/u.exec(value)?.[1]; return mapped !== undefined && blockedIpv4(mapped);
}
export async function validateAiBaseUrl(url: string, options: { lookup?: (host: string) => Promise<string[]>; allowPrivate?: boolean } = {}): Promise<boolean> {
  let parsed: URL; try { parsed = new URL(normalizeOpenAiBaseUrl(url)); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' || parsed.password !== '' || parsed.hostname === '') return false;
  if (options.allowPrivate === true) return true;
  const host = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) !== 0 && blockedIp(host))) return false;
  try {
    const addresses = options.lookup !== undefined ? await options.lookup(host) : (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
    return addresses.length > 0 && addresses.every((address) => !blockedIp(address));
  } catch { return false; }
}

type LegacyResult = { status: number; body: { code: 0 | 1; message?: string; data?: unknown } };
const fail = (status: number, message: string): LegacyResult => ({ status, body: { code: 1, message } });
export class AiProviderService {
  constructor(private readonly repository: AiProviderRepository, private readonly deps: { encrypt(value: string): string; decrypt(value: string): string; validateUrl(url: string): Promise<boolean>; client: OpenAiClient }) {}
  list(userId: number): Promise<LegacyResult> { return this.repository.list(userId).then((data) => ({ status: 200, body: { code: 0, data } })); }
  status(userId: number): Promise<LegacyResult> { return this.repository.status(userId).then((data) => ({ status: 200, body: { code: 0, data } })); }
  async save(userId: number, input: Record<string, unknown>): Promise<LegacyResult> {
    const id = Number(input.id ?? 0); const displayName = String(input.display_name ?? '').trim(); const baseUrl = normalizeOpenAiBaseUrl(String(input.base_url ?? '')); const modelName = String(input.model_name ?? '').trim(); const key = String(input.api_key ?? '').trim();
    if (displayName === '' || modelName === '' || !await this.deps.validateUrl(baseUrl)) return fail(422, '请完整填写名称、地址和模型');
    const old = id > 0 ? await this.repository.find(userId, id) : null;
    if (id > 0 && old === null) return fail(404, '配置不存在');
    if (id === 0 && key === '') return fail(422, '请输入API Key');
    await this.repository.save(userId, { id, displayName, baseUrl, apiKeyCiphertext: key === '' ? old!.api_key_ciphertext : this.deps.encrypt(key), apiKeyHint: key === '' ? old!.api_key_hint : maskApiKey(key), modelName, isActive: id === 0 && await this.repository.count(userId) === 0 });
    return { status: 200, body: { code: 0, message: '保存成功', data: await this.repository.list(userId) } };
  }
  private async credentials(userId: number, input: Record<string, unknown>): Promise<{ id: number; base: string; key: string; model: string } | LegacyResult> {
    const id = Number(input.id ?? 0); const stored = id > 0 ? await this.repository.find(userId, id) : null;
    if (id > 0 && stored === null) return fail(404, '配置不存在');
    const base = normalizeOpenAiBaseUrl(String(input.base_url ?? stored?.base_url ?? '')); const supplied = String(input.api_key ?? ''); const key = supplied === '' ? this.deps.decrypt(stored?.api_key_ciphertext ?? '') : supplied; const model = String(input.model_name ?? stored?.model_name ?? '').trim();
    if (key === '' || !await this.deps.validateUrl(base)) return fail(422, '请填写有效的API地址和Key');
    return { id, base, key, model };
  }
  async fetchModels(userId: number, input: Record<string, unknown>): Promise<LegacyResult> { const c = await this.credentials(userId, input); if ('status' in c) return c; try { return { status: 200, body: { code: 0, message: '模型获取成功', data: { models: await this.deps.client.fetchModels(c.base, c.key) } } }; } catch (e) { return fail(422, `测试失败：${e instanceof Error ? e.message : String(e)}`); } }
  async test(userId: number, input: Record<string, unknown>): Promise<LegacyResult> { const c = await this.credentials(userId, input); if ('status' in c) return c; try { const models = await this.deps.client.fetchModels(c.base, c.key); const model = c.model || models[0] || ''; if (model === '') throw new Error('没有可测试的模型'); await this.deps.client.test(c.base, c.key, model); if (c.id > 0) await this.repository.updateTest(userId, c.id, 'success', '连接正常'); return { status: 200, body: { code: 0, message: '连接测试成功', data: { models } } }; } catch (e) { const message = e instanceof Error ? e.message : String(e); if (c.id > 0) await this.repository.updateTest(userId, c.id, 'failed', message.slice(0, 255)); return fail(422, `测试失败：${message}`); } }
  async select(userId: number, id: number): Promise<LegacyResult> { try { await this.repository.select(userId, id); return { status: 200, body: { code: 0, message: '已切换使用' } }; } catch (e) { if (e instanceof AiProviderNotFoundError) return fail(404, '配置不存在'); throw e; } }
  async delete(userId: number, id: number): Promise<LegacyResult> { try { await this.repository.delete(userId, id); return { status: 200, body: { code: 0, message: '已删除' } }; } catch (e) { if (e instanceof AiProviderNotFoundError) return fail(404, '配置不存在'); if (e instanceof ActiveAiProviderDeleteError) return fail(409, '正在使用的配置不能删除，请先选择其他配置'); throw e; } }
}
