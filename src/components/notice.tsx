'use client';

export function Notice({ children, tone = 'error' }: { children: React.ReactNode; tone?: 'error' | 'success' | 'info' }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <p className="loading" role="status"><span aria-hidden="true" />{label}…</p>;
}
