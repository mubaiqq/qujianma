export interface PublicDevice {
  id: number;
  device_id: string;
  platform: string;
  name: string;
  app_version: string;
  token_prefix: string;
  last_used_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  push_provider: string | null;
  push_enabled: boolean;
  push_last_success_at: string | null;
  push_last_error: string;
}

export function validPositiveId(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const id = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}
