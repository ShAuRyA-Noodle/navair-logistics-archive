'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { Session } from './types';

export function Header() {
  const [session, setSession] = useState<Session | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => { void api<Session>('/api/auth/session').then(setSession).catch(() => setSession(null)); }, []);
  const user = session?.user;
  async function signOut() {
    setSigningOut(true);
    try { await api('/api/auth/logout', { method: 'POST' }); window.location.assign('/'); } finally { setSigningOut(false); }
  }
  return <>
    {session?.demoMode && <div className="demo-banner" role="status">Local demo — synthetic shipment history. Emails stay in preview.</div>}
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Navair logistics home">NAVAIR <span>LOGISTICS</span></Link>
      <nav aria-label="Main navigation">
        <Link href="/#enquire">Enquire</Link>
        <Link href="/forecast">Forecast</Link>
        <Link href="/portal">My shipments</Link>
        {user && user.role !== 'customer' && <Link href="/admin">Workspace</Link>}
        {user ? <button className="nav-button" onClick={signOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button> : <Link className="nav-button" href="/login">Sign in</Link>}
      </nav>
    </header>
  </>;
}
