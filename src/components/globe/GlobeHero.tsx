'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import styles from './globe-hero.module.css';
import type { createGlobe } from './globe-engine';

type Globe = ReturnType<typeof createGlobe>;

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.5" /></svg>;
}

export function GlobeHero() {
  const root = useRef<HTMLElement>(null);
  const globeHost = useRef<HTMLDivElement>(null);
  const engine = useRef<Globe | null>(null);
  const pausePreference = useRef(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let stopScroll: (() => void) | undefined;
    const syncMotion = () => { setReduced(media.matches); engine.current?.setReducedMotion(media.matches); engine.current?.setPaused(media.matches || pausePreference.current); };
    syncMotion();
    media.addEventListener('change', syncMotion);
    void import('./globe-engine').then(({ createGlobe }) => {
      if (disposed || !globeHost.current) return;
      engine.current = createGlobe(globeHost.current, {
        reducedMotion: media.matches,
        onReady: () => { if (!disposed) { setReady(true); setFailed(false); } },
        onError: () => { if (!disposed) setFailed(true); },
      });
      return Promise.all([import('gsap'), import('gsap/ScrollTrigger')]);
    }).then((modules) => {
      if (!modules || disposed || !root.current) return;
      const [{ gsap }, { ScrollTrigger }] = modules;
      gsap.registerPlugin(ScrollTrigger);
      const match = gsap.matchMedia();
      match.add('(prefers-reduced-motion: no-preference)', () => {
        const playhead = { progress: 0 };
        const timeline = gsap.timeline({
          scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true },
          onUpdate: () => {
            engine.current?.setScroll(playhead.progress);
            root.current?.style.setProperty('--departure', String(playhead.progress));
          },
        });
        timeline.to(playhead, { progress: 1, ease: 'none' });
        return () => { engine.current?.setScroll(0); root.current?.style.setProperty('--departure', '0'); };
      });
      stopScroll = () => match.revert();
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; media.removeEventListener('change', syncMotion); stopScroll?.(); engine.current?.destroy(); engine.current = null; };
  }, []);

  useEffect(() => { engine.current?.setPaused(paused || reduced); }, [paused, reduced, ready]);

  function closeMenu() { if (menu.current) menu.current.open = false; }
  function skip() { closeMenu(); document.getElementById('services')?.focus({ preventScroll: true }); }

  return <section className={styles.hero} ref={root} aria-labelledby="globe-heading" data-globe-state={failed ? 'fallback' : ready ? 'ready' : 'loading'}>
    <a className={styles.skip} href="#services" onClick={skip}>Skip to freight services</a>
    <div className={styles.utility}>
      <span><i /> GLOBAL MOVEMENT. PERSONAL RESPONSIBILITY.</span>
      <Link href="/forecast">EXPLORE ROUTE FORECASTS <Arrow diagonal /></Link>
    </div>
    <header className={styles.header}>
      <Link href="/" className={styles.wordmark} aria-label="Navair logistics home">NAVAIR<span className={styles.wordmarkSign} aria-hidden="true">↗</span><small>LOGISTICS</small></Link>
      <nav className={styles.desktopNav} aria-label="Homepage navigation">
        <a href="#approach">OUR APPROACH</a>
        <a href="#services">FREIGHT SERVICES</a>
        <Link href="/forecast">ROUTE FORECASTS</Link>
        <Link href="/news">TRADE WATCH</Link>
      </nav>
      <Link className={styles.headerCta} href="/first-time-exporter">LET’S TALK <Arrow diagonal /></Link>
      <details className={styles.mobileMenu} ref={menu} onKeyDown={(event) => { if (event.key === 'Escape') { closeMenu(); menu.current?.querySelector('summary')?.focus(); } }}>
        <summary><span className={styles.menuDots} aria-hidden="true">•••</span> MENU</summary>
        <nav aria-label="Mobile homepage navigation">
          <a href="#approach" onClick={closeMenu}>Our approach</a>
          <a href="#services" onClick={closeMenu}>Freight services</a>
          <Link href="/forecast">Route forecasts</Link>
          <Link href="/news">Trade watch</Link>
          <Link href="/first-time-exporter">Start an enquiry <Arrow diagonal /></Link>
        </nav>
      </details>
    </header>

    <div className={styles.space} aria-hidden="true"><div className={styles.starfield} /><div className={styles.horizon} /></div>
    <div className={`${styles.globePosition} ${ready && !failed ? styles.globeReady : ''}`} aria-hidden="true">
      <div className={styles.globeFallback}><div /><span /><i /></div>
      <div className={styles.globeHost} ref={globeHost} />
    </div>
    <div className={styles.copy}>
      <p className={styles.eyebrow}><span /> A WORLD IN MOTION. A CLEAR WAY FORWARD.</p>
      <h1 id="globe-heading">DISTANCE<br />DESERVES<br /><span>DIRECTION.</span></h1>
      <p className={styles.description}>Tell us what’s moving, where it’s going,<br className={styles.desktopBreak} /> and when it needs to arrive.<br className={styles.desktopBreak} /> Your next journey starts with Navair.</p>
      <div className={styles.actions}>
        <Link className={styles.primaryAction} href="/first-time-exporter">START AN ENQUIRY <Arrow diagonal /></Link>
        <a className={styles.secondaryAction} href="#services">OUR SERVICES <Arrow /></a>
      </div>
    </div>
    <div className={styles.footline}>
      <a href="#approach" className={styles.scrollHint}><span aria-hidden="true">↓</span> SCROLL TO EXPLORE</a>
      <span className={styles.geographicNote}>ONE WORLD. COUNTLESS POSSIBILITIES.</span>
      <button className={styles.motionButton} onClick={() => { pausePreference.current = !paused; setPaused(!paused); }} aria-pressed={paused || reduced} disabled={reduced || failed} aria-label={reduced ? 'Animation disabled by reduced-motion preference' : paused ? 'Resume globe animation' : 'Pause globe animation'}>
        <span aria-hidden="true">{paused || reduced ? '▷' : 'Ⅱ'}</span> {reduced ? 'REDUCED MOTION' : paused ? 'RESUME MOTION' : 'PAUSE MOTION'}
      </button>
    </div>
  </section>;
}
