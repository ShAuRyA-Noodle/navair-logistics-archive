'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion } from 'motion/react';
import type Lenis from 'lenis';
import { AnimatedCta } from './AnimatedCta';
import { HeroAtmosphere } from './HeroAtmosphere';
import { NavLabel } from './NavLabel';
import { FreightLoader } from './FreightLoader';
import { COUNTRY_BY_CODE } from './countries';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './globe-hero.module.css';
import { transitionAt } from './globe-transition';
import type { createGlobe } from './globe-engine';

const InlineEnquiry = dynamic(() => import('../first-time-exporter-form').then(module => module.FirstTimeExporterForm), { ssr: false, loading: () => <p role="status">Preparing your enquiry…</p> });

type Globe = ReturnType<typeof createGlobe>;

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.5" /></svg>;
}

export function GlobeHero() {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const globePosition = useRef<HTMLDivElement>(null);
  const approach = useRef<HTMLDivElement>(null);
  const heroCopy = useRef<HTMLDivElement>(null);
  const globeHost = useRef<HTMLDivElement>(null);
  const engine = useRef<Globe | null>(null);
  const smoothScroll = useRef<Lenis | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMounted, setFormMounted] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState({ originCode: '', destinationCode: '' });
  const menu = useRef<HTMLDetailsElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const sceneLoading = !failed && (!ready || !assetsReady);
  const loading = sceneLoading || !introDone;
  const finishIntro = useCallback(() => setIntroDone(true), []);

  useEffect(() => {
    let disposed = false;
    const stars = new Image();
    const background = new Promise<void>((resolve) => {
      stars.onload = () => resolve();
      stars.onerror = () => resolve();
      stars.src = '/images/navair-stars.svg';
    });
    void Promise.all([document.fonts.ready, background]).then(() => {
      if (!disposed) setAssetsReady(true);
    });
    return () => { disposed = true; stars.onload = null; stars.onerror = null; };
  }, []);

  useEffect(() => {
    if (!sceneLoading) return;
    // A failed GPU or asset request must never trap visitors behind the loader.
    const timeout = window.setTimeout(() => { setAssetsReady(true); setFailed(true); }, 12000);
    return () => window.clearTimeout(timeout);
  }, [sceneLoading]);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let stopScroll: (() => void) | undefined;
    const syncMotion = () => { setReduced(media.matches); engine.current?.setReducedMotion(media.matches);  };
    syncMotion();
    media.addEventListener('change', syncMotion);
    void import('./globe-engine').then(({ createGlobe }) => {
      if (disposed || !globeHost.current) return;
      engine.current = createGlobe(globeHost.current, {
        reducedMotion: media.matches,
        paused: true,
        onReady: () => { if (!disposed) { setReady(true); setFailed(false); } },
        onError: () => { if (!disposed) setFailed(true); },
      });
      return Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('lenis')]);
    }).then((modules) => {
      if (!modules || disposed || !root.current) return;
      const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = modules;
      gsap.registerPlugin(ScrollTrigger);
      const match = gsap.matchMedia();
      match.add('(prefers-reduced-motion: no-preference)', () => {
        const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, syncTouch: false, anchors: true });
        smoothScroll.current = lenis;
        lenis.on('scroll', ScrollTrigger.update);
        const advanceScroll = (time: number) => lenis.raf(time * 1000);
        gsap.ticker.add(advanceScroll);
        document.documentElement.dataset.navairSmooth = 'true';
        const playhead = { progress: 0 };
        let width = 0, height = 0, globeWidth = 0, initialCentre = 0;
        const update = () => {
          if (stage.current?.dataset.globeState === 'fallback') {
            if (approach.current) approach.current.inert = false;
            if (heroCopy.current) heroCopy.current.inert = false;
            return;
          }
          const state = transitionAt(playhead.progress);
          engine.current?.setScroll(playhead.progress);
          const small = width < 768;
          const destination = width * (small ? 0.5 : 0.65);
          const x = (width / 2 - initialCentre) * state.centre + (destination - width / 2) * state.dock;
          // At the final camera distance, the map occupies about 82% of the canvas.
          // Keep the full longitude range inside the phone, including Pacific islands.
          const finalScale = width * (small ? 0.96 : 0.68) / (globeWidth * 0.82);
          const centreScale = Math.min(1, width * 0.9 / globeWidth);
          const scale = 1 + (centreScale - 1) * state.centre + (finalScale - centreScale) * state.dock;
          heroCopy.current?.style.setProperty('--departure', String(state.centre));
          approach.current?.style.setProperty('--map-copy', String(state.copy));
          globePosition.current?.style.setProperty('--globe-x', `${x}px`);
          globePosition.current?.style.setProperty('--globe-y', `${small ? -height * 0.14 * state.dock : 0}px`);
          globePosition.current?.style.setProperty('--globe-scale', String(scale));
          if (approach.current && approach.current.inert !== (state.copy < 0.75)) approach.current.inert = state.copy < 0.75;
          if (heroCopy.current && heroCopy.current.inert !== (state.centre > 0.9)) heroCopy.current.inert = state.centre > 0.9;
        };
        const measure = () => {
          if (!stage.current || !globePosition.current) return;
          width = stage.current.clientWidth;
          height = stage.current.clientHeight;
          globeWidth = globePosition.current.offsetWidth;
          initialCentre = globePosition.current.offsetLeft + globeWidth / 2;
          update();
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(stage.current!);
        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: root.current, start: 'top top', end: 'bottom bottom', scrub: true,
            invalidateOnRefresh: true, onRefresh: measure,
          },
          onUpdate: update,
        });
        timeline.to(playhead, { progress: 1, duration: 1, ease: 'none' });
        return () => {
          observer.disconnect();
          gsap.ticker.remove(advanceScroll);
          lenis.destroy();
          smoothScroll.current = null;
          delete document.documentElement.dataset.navairSmooth;
          engine.current?.setScroll(0);
          stage.current?.style.setProperty('--departure', '0');
          stage.current?.style.setProperty('--map-copy', '1');
          globePosition.current?.style.removeProperty('--globe-x');
          globePosition.current?.style.removeProperty('--globe-y');
          globePosition.current?.style.removeProperty('--globe-scale');
          if (approach.current) approach.current.inert = false;
          if (heroCopy.current) heroCopy.current.inert = false;
        };
      });
      stopScroll = () => match.revert();
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; media.removeEventListener('change', syncMotion); stopScroll?.(); engine.current?.destroy(); engine.current = null; };
  }, []);

  useEffect(() => { engine.current?.setPaused(reduced); }, [reduced, ready]);

  useEffect(() => {
    engine.current?.setRoute(formOpen ? selectedRoute.originCode : '', formOpen ? selectedRoute.destinationCode : '');
  }, [formOpen, selectedRoute, ready]);

  useEffect(() => { engine.current?.setPaused(!introDone || reduced); }, [introDone, reduced, ready]);

  // Warm the form code without mounting its hidden DOM into the scroll animation tree.
  useEffect(() => {
    if (loading) return;
    const warmup = window.setTimeout(() => { void import('../first-time-exporter-form'); }, 500);
    return () => window.clearTimeout(warmup);
  }, [loading]);

  function openEnquiry() {
    closeMenu();
    setFormMounted(true);
    const reveal = () => { setFormOpen(true); };
    if (!root.current) return;
    if (reduced || failed) {
      reveal();
      requestAnimationFrame(() => approach.current?.scrollIntoView({ block: 'start', behavior: 'instant' }));
      return;
    }
    const target = root.current.getBoundingClientRect().top + window.scrollY + root.current.offsetHeight - window.innerHeight - 1;
    if (Math.abs(window.scrollY - target) < window.innerHeight * 0.15) { reveal(); return; }
    if (smoothScroll.current) smoothScroll.current.scrollTo(target, { duration: 0.8, lerp: 0, onComplete: reveal });
    else { window.scrollTo({ top: target, behavior: 'instant' }); reveal(); }
  }
  useEffect(() => {
    const onEnquiryLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest('a[href="#enquiry"]');
      if (!link) return;
      event.preventDefault(); openEnquiry();
    };
    document.addEventListener('click', onEnquiryLink);
    return () => document.removeEventListener('click', onEnquiryLink);
  }, [reduced, failed]);

  function closeEnquiry() {
    setFormOpen(false);
    requestAnimationFrame(() => approach.current?.querySelector('button')?.focus({ preventScroll: true }));
  }

  function closeMenu() { if (menu.current) menu.current.open = false; }
  function skip() { closeMenu(); document.getElementById('services')?.focus({ preventScroll: true }); }

  return <div className={styles.journey} ref={root} data-form-open={formOpen} data-presented={!loading} data-globe-state={failed ? 'fallback' : ready ? 'ready' : 'loading'}>
    <FreightLoader sceneReady={!sceneLoading} reduced={reduced} onComplete={finishIntro} />
    <noscript><style>{'[data-navair-loader]{display:none!important}'}</style></noscript>
    <div className={styles.approachAnchor} id="approach" aria-hidden="true" />
    <section className={styles.hero} ref={stage} aria-labelledby="globe-heading" data-globe-state={failed ? 'fallback' : ready ? 'ready' : 'loading'}>
    <a className={styles.skip} href="#services" onClick={skip}>Skip to freight services</a>
    <header className={styles.header}>
      <Link href="/" className={styles.wordmark} aria-label="Navair logistics home"><span>NAVAIR</span><small><span>LOGISTICS</span><span aria-hidden="true">LOGISTICS</span></small><i className={styles.brandRoute} aria-hidden="true" /></Link>
      <nav className={styles.desktopNav} aria-label="Homepage navigation">
        <a href="#approach"><NavLabel text="Our approach" /></a>
        <a href="#services"><NavLabel text="Freight services" /></a>
        <Link href="/forecast"><NavLabel text="Route forecasts" /></Link>
        <Link href="/news"><NavLabel text="Trade watch" /></Link>
      </nav>
      <AnimatedCta className={styles.talkCta} onClick={openEnquiry}>Let’s talk</AnimatedCta>
      <details className={styles.mobileMenu} ref={menu} onKeyDown={(event) => { if (event.key === 'Escape') { closeMenu(); menu.current?.querySelector('summary')?.focus(); } }}>
        <summary aria-label="Toggle navigation"><span className={styles.menuGlyph} aria-hidden="true"><i /><i /></span><span className={styles.menuLabel} aria-hidden="true"><span>MENU</span><span>CLOSE</span></span></summary>
        <nav aria-label="Mobile homepage navigation">
          <a href="#approach" onClick={closeMenu}>Our approach</a>
          <a href="#services" onClick={closeMenu}>Freight services</a>
          <Link href="/forecast">Route forecasts</Link>
          <Link href="/news">Trade watch</Link>
          <button type="button" onClick={openEnquiry}>Start an enquiry <Arrow diagonal /></button>
        </nav>
      </details>
    </header>

    <HeroAtmosphere />
    <div className={`${styles.globePosition} ${ready && !failed ? styles.globeReady : ''}`} ref={globePosition} aria-hidden="true">
      {failed && <div className={styles.globeFallback}><div /><span /><i /></div>}
      <div className={styles.globeHost} ref={globeHost} />
    </div>
    <div className={styles.copy} ref={heroCopy}>
      <p className={styles.eyebrow}><span /> A CLEAR WAY FORWARD.</p>
      <h1 id="globe-heading"><span className={styles.headingLine}><span>DISTANCE</span></span><span className={styles.headingLine}><span>DESERVES</span></span><span className={styles.headingLine}><span className={styles.headingAccent}>DIRECTION.<svg className={styles.headingMark} viewBox="0 0 600 30" preserveAspectRatio="none" aria-hidden="true"><path d="M4 19C130 5 367 4 593 12C430 10 267 17 171 23" pathLength="100"/></svg></span></span></h1>
      <p className={styles.description}>Your cargo. Your destination. Your timeline.<br />We bring clarity to everything in between.</p>
      <div className={styles.actions}>
        <AnimatedCta onClick={openEnquiry}>Start an enquiry</AnimatedCta>
        <AnimatedCta href="#services" secondary>Our services</AnimatedCta>
      </div>
    </div>
    <div className={styles.mapCopy} ref={approach} inert={!reduced && !failed}>
      <motion.div aria-hidden={formOpen} inert={formOpen} className={styles.approachIntro} initial={false} animate={{ opacity: formOpen ? 0 : 1, y: formOpen ? -12 : 0 }} transition={{ duration: reduced ? 0 : 0.24 }} style={{ pointerEvents: formOpen ? 'none' : 'auto' }}>
      <p className={styles.eyebrow}>THE NAVAIR APPROACH</p>
      <h2>THE WORLD IS <br />COMPLICATED.<br /><span>LET’S FIND <br />YOUR WAY.</span></h2>
      <p>Every journey starts with the right questions. Share your origin, destination and cargo details. We’ll bring the essentials together.</p>
      <AnimatedCta onClick={openEnquiry}>Start a conversation</AnimatedCta>
      <small>Routes shown are illustrative.</small>
      </motion.div>
      {formMounted && <motion.div aria-hidden={!formOpen} inert={!formOpen} className={styles.enquiryPanel} data-lenis-prevent
        initial={false} animate={{ opacity: formOpen ? 1 : 0, y: formOpen ? 0 : 12 }} transition={{ duration: reduced ? 0 : 0.28, delay: formOpen && !reduced ? 0.06 : 0 }} style={{ pointerEvents: formOpen ? 'auto' : 'none' }}>
        <div className={styles.enquiryTop}><span>YOUR NEXT JOURNEY</span><button type="button" onClick={closeEnquiry} aria-label="Close enquiry">Close <span aria-hidden="true">×</span></button></div>
        <InlineEnquiry embedded onRouteChange={setSelectedRoute} />
      </motion.div>}
    </div>
    {formOpen && <div className={styles.routeCaption} aria-live="polite">
      <span>{COUNTRY_BY_CODE.get(selectedRoute.originCode)?.name ?? 'Choose origin'}</span><span aria-hidden="true">→</span><span>{COUNTRY_BY_CODE.get(selectedRoute.destinationCode)?.name ?? 'Choose destination'}</span>
      <small>Country locations are illustrative. Route availability is confirmed after enquiry.</small>
    </div>}
  </section></div>;
}
