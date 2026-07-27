import Fastify from 'fastify';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { registerPageRoutes } from '../../src/modules/pages/routes.js';
import { registerSharingRoutes } from '../../src/modules/sharing/routes.js';
import type { AuthContext } from '../../src/platform/auth-context.js';

const auth: AuthContext = {
  authenticate: vi.fn().mockResolvedValue(null), require: vi.fn(), requireCsrf: vi.fn(),
  csrf: vi.fn().mockReturnValue('csrf'), clear: vi.fn(),
};

function pageHarness(html: string) {
  const listeners = new Map<string, (event: unknown) => void>();
  const rows = new Map<number, { dataset: { parcel: string; code: string }; remove: ReturnType<typeof vi.fn>; classList: { add: ReturnType<typeof vi.fn> }; closest: ReturnType<typeof vi.fn> }>();
  const content = {
    _html: '',
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    set innerHTML(value: string) {
      this._html = value;
      rows.clear();
      for (const match of value.matchAll(/data-parcel="(\d+)" data-code="([^"]*)"/g)) {
        const group = { querySelectorAll: vi.fn().mockReturnValue([]), remove: vi.fn(), querySelector: vi.fn().mockReturnValue({ textContent: '' }) };
        rows.set(Number(match[1]), { dataset: { parcel: match[1]!, code: match[2]! }, remove: vi.fn(), classList: { add: vi.fn() }, closest: vi.fn().mockReturnValue(group) });
      }
    },
    get innerHTML() { return this._html; },
  };
  const count = { textContent: '0' };
  const copy = { classList: { remove: vi.fn(), add: vi.fn() }, querySelector: vi.fn().mockReturnValue({ textContent: '' }), addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(`copy:${name}`, callback) };
  const toast = { textContent: '', classList: { add: vi.fn(), remove: vi.fn() }, t: undefined as unknown };
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (!init) return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { expiresAt: '2026-07-26T10:00:00.000Z', items: [
      { id: 11, pickup_code: 'A-11', station_id: 1, station_name: '一号站', station_address: '人民路1号', courier_name: '顺丰快递', received_at: '2026-07-26 08:00:00' },
      { id: 12, pickup_code: 'B-12', station_id: 1, station_name: '一号站', station_address: '人民路1号', courier_name: '京东快递', received_at: '2026-07-26 08:10:00' },
      { id: 13, pickup_code: 'C-13', station_id: 2, station_name: '二号站', station_address: '解放路2号', courier_name: '中通快递', received_at: '2026-07-26 08:20:00' },
      { id: 14, pickup_code: 'D-14', station_id: 2, station_name: '二号站', station_address: '解放路2号', courier_name: '圆通快递', received_at: '2026-07-26 08:30:00' },
    ] } }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0 }) });
  });
  const document = {
    getElementById: (id: string) => id === 'shareContent' ? content : id === 'pendingCount' ? count : id === 'shareToast' ? toast : copy,
    querySelectorAll: () => [...rows.values()],
  };
  const context = { window: {}, document, navigator: { clipboard }, fetch, alert: vi.fn(), Promise, encodeURIComponent, Number, String, Math, setTimeout };
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].at(-1)?.[1];
  if (!script) throw new Error('share script missing');
  vm.runInNewContext(script, context);
  return { content, count, copy, clipboard, requests, rows, listeners };
}

async function flush() { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); }

describe('public share real HTTP and page script regression', () => {
  it('loads four parcels, copies all codes, and marks one picked through the Node public route', async () => {
    const service = {
      status: vi.fn(), createOrReuse: vi.fn(), regenerate: vi.fn(), cancel: vi.fn(),
      getPublic: vi.fn().mockResolvedValue({ expiresAt: new Date('2026-07-26T10:00:00Z'), items: [] }),
      markPublicPicked: vi.fn().mockResolvedValue(undefined),
    };
    const app = Fastify();
    registerSharingRoutes(app, { service, resolveSession: vi.fn().mockResolvedValue(null), verifyCsrf: vi.fn() });
    registerPageRoutes(app, { auth });
    const response = await app.inject('/share?t=public-token');
    expect(response.statusCode).toBe(200);
    const page = pageHarness(response.body);
    await flush();
    expect(page.count.textContent).toBe('4');
    expect(page.rows.size).toBe(4);
    expect(page.content.innerHTML).toContain('class="station-group"');
    expect(page.content.innerHTML).toContain('class="station-head"');
    expect(page.content.innerHTML).toContain('/assets/images/couriers/sf.webp');
    expect(page.content.innerHTML).toContain('/assets/images/couriers/jindong.webp');
    expect(page.content.innerHTML).toContain('class="check-button"');
    expect(page.content.innerHTML).not.toContain('class="pickup-button"');
    expect(page.content.innerHTML).not.toContain('alert(');
    page.listeners.get('copy:click')?.({});
    expect(page.clipboard.writeText).toHaveBeenCalledWith('A-11\nB-12\nC-13\nD-14');
    const row = page.rows.get(11)!;
    page.listeners.get('click')?.({ target: { closest: () => ({ disabled: false, classList: { add: vi.fn(), remove: vi.fn() }, closest: () => row }) } });
    await flush();
    expect(page.requests.at(-1)).toMatchObject({ url: '/api/public/share/picked', init: { method: 'POST' } });
    expect(JSON.parse(page.requests.at(-1)?.init?.body as string)).toEqual({ t: 'public-token', id: 11 });
    expect(row.remove).toHaveBeenCalled();
    await app.close();
  });

  it('keeps legacy POST /share compatible and delegates token and parcel id safely', async () => {
    const service = {
      status: vi.fn(), createOrReuse: vi.fn(), regenerate: vi.fn(), cancel: vi.fn(), getPublic: vi.fn(),
      markPublicPicked: vi.fn().mockResolvedValue(undefined),
    };
    const app = Fastify();
    registerSharingRoutes(app, { service, resolveSession: vi.fn().mockResolvedValue(null), verifyCsrf: vi.fn() });
    registerPageRoutes(app, { auth });
    const response = await app.inject({ method: 'POST', url: '/share?t=public-token', payload: { id: 11 } });
    expect(response.statusCode).toBe(200);
    expect(service.markPublicPicked).toHaveBeenCalledWith('public-token', 11);
    await app.close();
  });
});
