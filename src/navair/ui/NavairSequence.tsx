'use client';

/**
 * Section shell for the Navair_00 scroll sequence on the homepage.
 *
 * Server-rendered at its final height, so the page's scroll length, the
 * #services anchor and every ScrollTrigger above it are correct before any of
 * the sequence's JavaScript arrives. The heavy part (engine, machines, water,
 * GSAP timeline) is a separate chunk loaded with next/dynamic and mounted:
 *  - when the browser is idle after the page has loaded (so it is warm by the
 *    time the visitor scrolls past the globe), or
 *  - as soon as the shell comes within ~1.5 viewports, whichever comes first.
 * Until then the sticky poster shows the closed container doors the sequence
 * opens on, so even a very fast scroll lands on the right picture.
 */

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { filmReadiness } from '@/components/scene/film-readiness';
import { CHAPTERS, DURATION } from '../story';
import styles from './sequence.module.css';

const Experience = dynamic(() => import('./Experience'), { ssr: false });

/** Where "Freight services" lands: just after the services panel has risen on the road. */
const SERVICES_T = (CHAPTERS.find((c) => c.id === 'road')?.t ?? 12) + 1.9;

export function NavairSequence() {
  const shell = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);

  // The globe's FreightLoader still waits on the (retired) plane film's readiness store.
  // This section never needs the loader to wait: its shell is server-rendered at full
  // height and the engine warms lazily, so report ready at once.
  useEffect(() => { filmReadiness.set('ready'); }, []);

  useEffect(() => {
    const el = shell.current;
    if (!el || mounted) return;
    let idle = 0, timer = 0;
    const mount = () => setMounted(true);
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) mount(); }, { rootMargin: '150% 0px 150% 0px' });
    io.observe(el);
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
    const cic = window.cancelIdleCallback ?? window.clearTimeout;
    // Give the globe hero its first paint, loader and intro before warming the sequence.
    const warm = () => { timer = window.setTimeout(() => { idle = ric(mount, { timeout: 4000 }); }, 2500); };
    if (document.readyState === 'complete') warm();
    else window.addEventListener('load', warm, { once: true });
    return () => {
      io.disconnect();
      window.removeEventListener('load', warm);
      window.clearTimeout(timer);
      cic(idle);
    };
  }, [mounted]);

  return (
    <section ref={shell} className={styles.shell} style={{ height: `${(DURATION + 1) * 100}svh` }} aria-label="One box, every mile: from the container stack to open water">
      <a className={styles.skip} href="#after-sequence">Skip the story</a>
      <div id="services" className={styles.anchor} style={{ top: `${SERVICES_T * 100}svh` }} tabIndex={-1} aria-hidden="true" />
      <div className={styles.poster} aria-hidden="true"><div className={styles.posterDoors} /></div>
      {mounted && <Experience />}
      <div id="after-sequence" className={styles.end} tabIndex={-1} />
    </section>
  );
}
