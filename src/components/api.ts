export type ApiError = { code: string; message: string; fields?: Record<string, string[]> };

export class RequestError extends Error {
  code: string;
  fields?: Record<string, string[]>;
  constructor(error: ApiError) {
    super(error.message);
    this.code = error.code;
    this.fields = error.fields;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init.headers ?? {}) },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isErrorResponse(body) ? body.error : { code: 'REQUEST_FAILED', message: 'The request could not be completed. Please try again.' };
    throw new RequestError(error);
  }
  return body as T;
}

function isErrorResponse(value: unknown): value is { error: ApiError } {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'object' && value.error !== null
    && 'code' in value.error && 'message' in value.error;
}

export function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export function patch(body: unknown): RequestInit {
  return { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
