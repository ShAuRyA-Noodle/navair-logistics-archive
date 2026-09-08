'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/components/api';
import { Loading, Notice } from '@/components/notice';
import type { Actor, Session } from '@/components/types';

export default function LoginPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [users, setUsers] = useState<Actor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void api<Session>('/api/auth/session').then((value) => { setSession(value); if (value.demoMode) return api<{ users: Actor[] }>('/api/auth/demo').then((result) => setUsers(result.users)); return undefined; }).catch((reason) => setError(errorMessage(reason))); }, []);
  async function choose(user: Actor) { setBusy(user.id); setError(null); try { await api('/api/auth/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id }) }); router.replace(user.role === 'customer' ? '/portal' : '/admin'); router.refresh(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(null); } }
  return <div className="page-shell narrow"><section className="card login-card"><p className="eyebrow">Account access</p><h1>Sign in to Navair.</h1>{error && <Notice>{error}</Notice>}{!session ? <Loading /> : session.demoMode ? <><p className="muted">Local demo profiles are for this preview only. They are not Google accounts.</p><div className="profile-list">{users.map((user) => <button key={user.id} className="profile" onClick={() => void choose(user)} disabled={busy !== null}><span><strong>{user.name}</strong><small>{user.role} · {user.email}</small></span><span>{busy === user.id ? 'Signing in…' : 'Use profile'}</span></button>)}</div></> : <><p>Use your approved Google account to view your shipments or workspace.</p>{session.googleConfigured ? <a className="button-link" href="/api/auth/google">Continue with Google</a> : <p className="notice notice-info">Google sign-in has not been configured for this workspace.</p>}</>}</section></div>;
}
