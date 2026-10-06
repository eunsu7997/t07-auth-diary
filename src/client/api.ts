export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    cache: 'no-store',
  });
  if (response.status === 401) window.dispatchEvent(new Event('t07-session-expired'));
  if (response.status === 204) return undefined as T;
  const payload = await response.json() as { error?: string; details?: { field: string; message: string }[] };
  if (!response.ok) {
    const details = payload.details?.map((d: { field: string; message: string }) => `${d.field}: ${d.message}`).join(' / ');
    throw new Error(`${payload.error ?? '요청에 실패했습니다.'}${details ? ` ${details}` : ''}`);
  }
  return payload as T;
}
