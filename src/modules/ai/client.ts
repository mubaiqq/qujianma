import { extractJsonObject, openAiEndpoint, validateAiBaseUrl, type OpenAiClient } from './domain.js';

export interface HttpResponse { status: number; json(): Promise<unknown> }
export type HttpTransport = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<HttpResponse>;

export class AiClientError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean, readonly originalCause?: unknown) { super(message); this.name = 'AiClientError'; }
}

function errorMessage(data: unknown, status: number): string { if (data !== null && typeof data === 'object') { const record = data as Record<string, unknown>; const nested = record.error; if (nested !== null && typeof nested === 'object') { const message = (nested as Record<string, unknown>).message; if (typeof message === 'string') return message; } if (typeof record.message === 'string') return record.message; } return `HTTP ${status}`; }
export class OpenAiCompatibleClient implements OpenAiClient {
  constructor(private readonly transport: HttpTransport = (url, init) => fetch(url, init), private readonly allowPrivate = false) {}
  async request(method: string, url: string, apiKey: string, payload?: Record<string, unknown>, timeout = 25_000): Promise<Record<string, unknown>> {
    if (!await validateAiBaseUrl(url, { allowPrivate: this.allowPrivate })) throw new Error('API地址不安全或格式错误');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.transport(url, { method, headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: controller.signal });
      let data: unknown; try { data = await response.json(); } catch (cause) { throw new AiClientError('服务返回的不是有效JSON', response.status, false, cause); }
      if (response.status < 200 || response.status >= 300) throw new AiClientError(errorMessage(data, response.status).slice(0, 240), response.status, response.status === 408 || response.status === 429 || response.status >= 500);
      return data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
    } catch (error) {
      if (error instanceof AiClientError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = controller.signal.aborted || /timeout|timed out|network|socket|fetch failed|econnreset|econnrefused|enotfound|eai_again/iu.test(message);
      throw new AiClientError(controller.signal.aborted ? `请求超时（${timeout}ms）` : message, null, transient, error);
    } finally { clearTimeout(timer); }
  }
  async fetchModels(base: string, key: string): Promise<string[]> { const data = await this.request('GET', openAiEndpoint(base, 'models'), key, undefined, 15_000); const rows = Array.isArray(data.data) ? data.data : []; return [...new Set(rows.flatMap((row) => row !== null && typeof row === 'object' && typeof (row as Record<string, unknown>).id === 'string' ? [(row as { id: string }).id] : []))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })); }
  async test(base: string, key: string, model: string): Promise<void> { await this.chat(base, key, { model, messages: [{ role: 'user', content: '只返回JSON：{"ok":true}' }], temperature: 0, response_format: { type: 'json_object' } }, 25_000); }
  async chat(base: string, key: string, payload: Record<string, unknown>, timeout = 25_000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeout;
    const thinking = { thinking: { type: 'disabled' }, reasoning_effort: 'minimal', enable_thinking: false, chat_template_kwargs: { enable_thinking: false } };
    try { return await this.request('POST', openAiEndpoint(base, 'chat/completions'), key, { ...payload, ...thinking }, timeout); }
    catch (e) { const message = e instanceof Error ? e.message : String(e); if (!/thinking|reasoning|enable_thinking|unsupported|unknown|invalid parameter|extra fields|not support/iu.test(message)) throw e; const remaining = deadline - Date.now(); if (remaining <= 0) throw e; return this.request('POST', openAiEndpoint(base, 'chat/completions'), key, payload, remaining); }
  }
  content(response: Record<string, unknown>): Record<string, unknown> { const choices = response.choices; const first: unknown = Array.isArray(choices) ? choices[0] : undefined; const message: unknown = first !== null && typeof first === 'object' ? (first as Record<string, unknown>).message : undefined; const content: unknown = message !== null && typeof message === 'object' ? (message as Record<string, unknown>).content : undefined; if (typeof content !== 'string') throw new Error('模型没有返回内容'); return extractJsonObject(content); }
}
