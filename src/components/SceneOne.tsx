'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './scene-one.module.css';

/** Seek only after the previous frame decoded; rapid input always keeps the latest target. */
export function SceneOne() {
  const section = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const root = section.current!, film = video.current!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false, target = 0, frame = 0;
    let cleanup: (() => void) | undefined;
    const seek = () => {
      frame = 0;
      if (disposed || reduced.matches || film.seeking || film.readyState < 2 || !Number.isFinite(film.duration)) return;
      const time = target * Math.max(0, film.duration - 1 / 24);
      if (Math.abs(film.currentTime - time) > 1 / 48) film.currentTime = time;
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(seek); };
    film.addEventListener('seeked', queue);
    film.addEventListener('loadeddata', queue);
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { film.preload = 'auto'; film.load(); observer.disconnect(); }
    }, { rootMargin: '1200px' });
    observer.observe(root);
    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{gsap}, {ScrollTrigger}]) => {
      if (disposed) return;
      gsap.registerPlugin(ScrollTrigger);
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const trigger = ScrollTrigger.create({ trigger: root, start: 'top top', end: 'bottom bottom',
          onUpdate: self => { target = self.progress; queue(); },
          onRefresh: self => { target = self.progress; queue(); },
        });
        target = trigger.progress; queue();
        return () => trigger.kill();
      });
      cleanup = () => media.revert();
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => {
      disposed = true; cleanup?.(); observer.disconnect(); cancelAnimationFrame(frame);
      film.removeEventListener('seeked', queue); film.removeEventListener('loadeddata', queue);
    };
  }, []);
  return <section ref={section} id="services" tabIndex={-1} className={styles.scene} aria-label="Navair: from runway to sky" data-failed={failed}>
    <div className={styles.stage}>
      <div className={styles.film}>
        {/* The poster remains beneath the video until its first decoded frame is available. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.poster} src="/video/scene01-poster.jpg" alt="Navair aircraft on the airport runway" />
        <video ref={video} className={styles.video} data-ready={ready && !failed} muted playsInline preload="none"
          poster="/video/scene01-poster.jpg" onLoadedData={() => setReady(true)} onError={() => setFailed(true)} aria-hidden="true">
          <source src="/video/scene01-scroll.mp4" type="video/mp4" />
        </video>
      </div>
      <div className={styles.caption}><span>NAVAIR · 01</span><h2>Every journey begins<br />with a clear direction.</h2></div>
    </div>
  </section>;
}
