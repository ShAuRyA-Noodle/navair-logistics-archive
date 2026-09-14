'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './scene-one.module.css';

type Chapter = { time: number; label: string; title: string };
type FilmMetadata = { duration: number; fps: number; chapters: Chapter[] };
type Mode = 'scroll' | 'play';
const FALLBACK: FilmMetadata = { duration: 30.083333, fps: 24, chapters: [{ time: 0, label: 'NAVAIR FILM', title: 'From runway to the world' }] };

export function SceneOne() {
  const sectionRef = useRef<HTMLElement>(null), videoRef = useRef<HTMLVideoElement>(null);
  const targetTime = useRef(0), scrollProgress = useRef(0), metadata = useRef(FALLBACK);
  const modeRef = useRef<Mode>('scroll'), objectUrl = useRef<string | null>(null), loadRef = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState<Mode>('scroll');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [ended, setEnded] = useState(false);
  const [chapter, setChapter] = useState(FALLBACK.chapters[0]);

  const applyTarget = useCallback(() => {
    const film = videoRef.current;
    if (!film || modeRef.current !== 'scroll' || film.seeking || film.readyState < 1) return;
    const fps = metadata.current.fps || 24;
    const duration = Number.isFinite(film.duration) ? film.duration : metadata.current.duration;
    const next = Math.min(Math.max(0, Math.round(targetTime.current * fps) / fps), Math.max(0, duration - 1 / fps));
    if (Math.abs(film.currentTime - next) > 0.5 / fps) film.currentTime = next;
  }, []);

  useEffect(() => {
    const root = sectionRef.current, film = videoRef.current;
    if (!root || !film) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false, request: AbortController | undefined, killTrigger: (() => void) | undefined;
    const updateChapter = (time: number) => {
      let active = metadata.current.chapters[0] ?? FALLBACK.chapters[0];
      for (const item of metadata.current.chapters) if (item.time <= time) active = item;
      setChapter(current => current.time === active.time && current.label === active.label ? current : active);
    };
    const loadFilm = () => {
      if (disposed || request || objectUrl.current || film.src) return;
      request = new AbortController(); setStatus('loading');
      const source = matchMedia('(max-width: 760px)').matches ? '/video/navair-film-mobile.mp4?v=movie-0-v2' : '/video/navair-film-desktop.mp4?v=movie-0-v2';
      void Promise.all([
        fetch('/video/navair-film.json?v=movie-0-v2', { signal: request.signal }).then(r => r.ok ? r.json() as Promise<FilmMetadata> : FALLBACK).catch(() => FALLBACK),
        fetch(source, { signal: request.signal }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }),
      ]).then(([details, blob]) => {
        if (disposed) return;
        metadata.current = { duration: details.duration || 30.083333, fps: details.fps || 24, chapters: details.chapters?.length ? details.chapters : FALLBACK.chapters };
        targetTime.current = scrollProgress.current * metadata.current.duration;
        updateChapter(targetTime.current);
        objectUrl.current = URL.createObjectURL(blob); film.src = objectUrl.current; film.load();
      }).catch(() => { if (!disposed) setStatus('error'); request = undefined; });
    };
    loadRef.current = loadFilm;
    const onReady = () => { setStatus('ready'); modeRef.current === 'play' ? void film.play().catch(() => { modeRef.current = 'scroll'; setMode('scroll'); applyTarget(); }) : applyTarget(); };
    const onTime = () => { updateChapter(film.currentTime); if (modeRef.current === 'play') { const d = film.duration || metadata.current.duration; setProgress(film.currentTime / d); } };
    // Hold the arrival frame until the viewer explicitly resumes scrolling.
    const onEnded = () => { setEnded(true); setProgress(1); updateChapter(metadata.current.duration); };
    const onError = () => {
      if (!film.src) return;
      film.pause(); film.removeAttribute('src');
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null; request = undefined; setStatus('error');
    };
    film.addEventListener('loadeddata', onReady); film.addEventListener('seeked', applyTarget); film.addEventListener('timeupdate', onTime); film.addEventListener('ended', onEnded); film.addEventListener('error', onError);
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { if (!reduced.matches) loadFilm(); observer.disconnect(); } }, { rootMargin: '100% 0px' });
    observer.observe(root);
    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (disposed) return; gsap.registerPlugin(ScrollTrigger);
      const trigger = ScrollTrigger.create({ trigger: root, start: 'top top', end: 'bottom bottom',
        onUpdate: self => { scrollProgress.current = self.progress; if (modeRef.current !== 'scroll') return; targetTime.current = self.progress * metadata.current.duration; setProgress(self.progress); updateChapter(targetTime.current); applyTarget(); },
        onRefresh: self => { scrollProgress.current = self.progress; targetTime.current = self.progress * metadata.current.duration; if (modeRef.current === 'scroll') applyTarget(); },
      });
      killTrigger = () => trigger.kill();
    }).catch(() => setStatus('error'));
    return () => {
      disposed = true; observer.disconnect(); killTrigger?.(); request?.abort(); loadRef.current = null; film.pause();
      film.removeEventListener('loadeddata', onReady); film.removeEventListener('seeked', applyTarget); film.removeEventListener('timeupdate', onTime); film.removeEventListener('ended', onEnded); film.removeEventListener('error', onError);
      film.removeAttribute('src'); film.load(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null;
    };
  }, [applyTarget]);

  const chooseMode = (next: Mode) => {
    const film = videoRef.current; modeRef.current = next; setMode(next); setEnded(false); loadRef.current?.(); if (!film) return;
    if (next === 'play') { if (film.ended) film.currentTime = 0; if (film.readyState >= 2) void film.play().catch(() => setStatus('error')); }
    else { film.pause(); targetTime.current = scrollProgress.current * metadata.current.duration; setProgress(scrollProgress.current); applyTarget(); }
  };

  return <section ref={sectionRef} id="services" className={styles.scene} aria-label="Navair logistics film">
    <div className={styles.stage}>
      <div className={styles.film}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.poster} src="/video/navair-film-poster.jpg" alt="Navair cargo aircraft ready for departure" />
        <video ref={videoRef} className={styles.video} data-ready={status === 'ready'} muted playsInline preload="none" poster="/video/navair-film-poster.jpg" aria-label="Navair global logistics journey" />
      </div>
      <div className={styles.controls} data-lenis-prevent>
        <div className={styles.modePicker} role="group" aria-label="Film controls">
          <button type="button" aria-pressed={mode === 'scroll'} onClick={() => chooseMode('scroll')}>Explore with scroll</button>
          <button type="button" aria-pressed={mode === 'play'} onClick={() => chooseMode('play')}>{ended ? 'Replay film' : mode === 'play' ? 'Playing film' : 'Play film'}</button>
        </div>
        {status === 'loading' && <span className={styles.status} role="status">Preparing film…</span>}
        {status === 'error' && <button type="button" className={styles.retry} onClick={() => { setStatus('idle'); loadRef.current?.(); }}>Film unavailable · Retry</button>}
      </div>
      <div className={styles.timeline}>
        <span className={styles.chapter} aria-live="polite">{chapter.label}</span><span className={styles.title}>{chapter.title}</span>
        <div className={styles.track} aria-hidden="true"><i style={{ transform: `scaleX(${progress})` }} /></div>
        <span className={styles.percent}>{Math.round(progress * 100).toString().padStart(2, '0')}%</span>
      </div>
    </div>
  </section>;
}
