import { appPath } from './base-path';
let clientId: string | undefined;
export const activeEditLeases = new Map<string, string>();
export function collaborationClientId() {
  return (clientId ??= crypto.randomUUID());
}
export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const workspace =
    typeof document === 'undefined' ? undefined : document.documentElement.dataset.workspace;
  if (workspace) {
    headers['X-Maket-Workspace'] = workspace;
    headers['X-Maket-Client'] = collaborationClientId();
    if (activeEditLeases.size)
      headers['X-Maket-Leases'] = JSON.stringify(
        [...activeEditLeases].map(([rootId, leaseId]) => ({ rootId, leaseId })),
      );
  }
  const response = await fetch(appPath(`/api/${path}`), {
    method,
    keepalive: method === 'DELETE' && path.startsWith('collaboration/locks/'),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Ошибка запроса');
  return data;
}
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function readJson(file: File) {
  if (file.size > 2_000_000) throw new Error('Максимальный размер файла — 2 МБ');
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error('Файл содержит некорректный JSON');
  }
}
export const date = (value: string) =>
  new Date(value).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
