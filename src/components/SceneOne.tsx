'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './scene-one.module.css';
import dynamic from 'next/dynamic';
const CanvasScene = dynamic(() => import('./scene/CanvasScene'), { ssr: false, loading: () => <section id="services" className={styles.scene} aria-label="Airport scene preparing" /> });

export function SceneOne() {
  const [canvasMode, setCanvasMode] = useState<boolean | null>(null);
  useEffect(() => { setCanvasMode(new URLSearchParams(location.search).get('scene') === 'canvas'); }, []);
  if (canvasMode === null) return <section id="services" className={styles.scene} aria-label="Airport scene preparing" />;
  return canvasMode ? <CanvasScene /> : <VideoScene />;
}

/** Seek only after the previous frame decoded; rapid input always keeps the latest target. */
function VideoScene() {
  const section = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const root = section.current!, film = video.current!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false, target = 0, frame = 0;
    let objectUrl: string | undefined;
    const request = new AbortController();
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
    film.addEventListener('canplay', queue);
    // Download one viewport-appropriate asset before seeking. This avoids repeated
    // remote byte-range requests when the user rapidly reverses direction.
    if (!reduced.matches) {
      setLoading(true);
      const source = matchMedia('(max-width: 900px)').matches
        ? '/video/scene01-mobile.mp4' : '/video/scene01-scroll.mp4';
      void fetch(source, { signal: request.signal }).then(response => {
        if (!response.ok) throw new Error('Video download failed');
        return response.blob();
      }).then(blob => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        film.src = objectUrl;
        film.load();
      }).catch((error: unknown) => {
        if (!disposed) {
          root.dataset.loadError = error instanceof Error ? error.message : 'Video download failed';
          // A failed bulk fetch must not permanently strand users on the poster.
          // Let the browser's media loader retry with ordinary range requests.
          film.preload = 'auto';
          film.src = source;
          film.load();
        }
      });
    }
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
      disposed = true; cleanup?.(); request.abort(); cancelAnimationFrame(frame);
      film.removeEventListener('seeked', queue); film.removeEventListener('loadeddata', queue);
      film.removeEventListener('canplay', queue);
      film.removeAttribute('src'); film.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);
  return <section ref={section} id="services" tabIndex={-1} className={styles.scene} aria-label="Navair: from runway to sky" data-failed={failed}>
    <div className={styles.stage}>
      <div className={styles.film}>
        {/* The poster remains beneath the video until its first decoded frame is available. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.poster} src="/video/scene01-poster.jpg" alt="Navair aircraft on the airport runway" />
        <video ref={video} className={styles.video} data-ready={ready && !failed} muted playsInline preload="none"
          poster="/video/scene01-poster.jpg" onLoadedData={() => { setReady(true); setLoading(false); setFailed(false); }} onError={() => { setFailed(true); setLoading(false); }} aria-hidden="true">
        </video>
      </div>
      <div className={styles.caption}>{loading && <p className={styles.status} role="status">Preparing your flight…</p>}<span>NAVAIR · 01</span><h2>Every journey begins<br />with a clear direction.</h2></div>
    </div>
  </section>;
}
