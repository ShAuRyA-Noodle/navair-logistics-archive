'use client';
import {useEffect, useRef, useState} from 'react';
import styles from './freight-loader.module.css';

function Ship(){return <><path d="M-13 3h26l-4 8H-8l-5-8Zm5 0V-5H5v8M-4-5v-5h5v5M-15 14q4-3 8 0t8 0 8 0 7 0"/><path d="M-5-1h3m3 0h3"/></>}
function Plane(){return <path d="M0-15 3-4l12 7v3L3 2l-1 9 4 3v2l-6-2-6 2v-2l4-3-1-9-12 4V3l12-7L0-15Z"/>}
function Truck(){return <><path d="M-15-8H4V8h-19V-8Zm19 4h6l5 7v5H4M5 2h9"/><circle cx="-9" cy="10" r="3"/><circle cx="10" cy="10" r="3"/></>}

export function FreightLoader({sceneReady, reduced, onComplete}: {sceneReady:boolean; reduced:boolean; onComplete:()=>void}) {
  const overlay = useRef<HTMLDivElement>(null);
  // The loader waits only for the globe scene (GPU programs compiled) plus one lap of
  // the orbit animation. It no longer depends on the retired plane film.
  const [minimum, setMinimum] = useState(false), [escape, setEscape] = useState(false);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (finished || !overlay.current) return;
    // Keep keyboard navigation inside the loading experience without changing layout.
    const blocked = new Map<HTMLElement, boolean>();
    let branch: HTMLElement = overlay.current;
    while (branch.parentElement && branch !== document.body) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          blocked.set(sibling, sibling.inert); sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    const preventScroll = (event: Event) => event.preventDefault();
    window.addEventListener('wheel', preventScroll, {passive: false});
    window.addEventListener('touchmove', preventScroll, {passive: false});
    return () => {
      blocked.forEach((inert, element) => { element.inert = inert; });
      window.removeEventListener('wheel', preventScroll);
      window.removeEventListener('touchmove', preventScroll);
    };
  }, [finished]);
  useEffect(() => {
    const b = window.setTimeout(() => setEscape(true), 5000);
    return () => clearTimeout(b);
  }, []);
  useEffect(() => {
    if (!sceneReady) return;
    const timer = window.setTimeout(() => setMinimum(true), 2200);
    return () => clearTimeout(timer);
  }, [sceneReady]);
  useEffect(() => {
    if (finished || !sceneReady) return;
    if (minimum || reduced) { setFinished(true); onComplete(); }
  }, [sceneReady, minimum, reduced, finished, onComplete]);
  const enter = () => { setFinished(true); onComplete(); };
  return <div ref={overlay} className={styles.loader} data-navair-loader data-scene-ready={sceneReady} data-complete={finished} aria-hidden={finished}>
    <div className={styles.composition}>
      <svg className={styles.orbit} viewBox="0 0 360 360" fill="none" aria-hidden="true">
        <circle cx="180" cy="180" r="155" className={styles.outer}/>
        <circle cx="180" cy="180" r="130" className={styles.track}/>
        <circle cx="180" cy="180" r="109" className={styles.inner}/>
        <circle cx="180" cy="180" r="130" className={styles.trace} pathLength="100"/>
        <g className={styles.carriage}><circle cx="180" cy="50" r="4" fill="#e0bd75"/></g>
        <g className={`${styles.station} ${styles.first}`} transform="translate(180 50)"><circle r="25"/><Ship/></g>
        <g className={`${styles.station} ${styles.second}`} transform="translate(310 180)"><circle r="25"/><Plane/></g>
        <g className={`${styles.station} ${styles.third}`} transform="translate(180 310)"><circle r="25"/><Ship/></g>
        <g className={`${styles.station} ${styles.fourth}`} transform="translate(50 180)"><circle r="25"/><Truck/></g>
      </svg>
      <div className={styles.identity}><strong>NAVAIR</strong><span>LOGISTICS</span><i/></div>
    </div>
    <p className={styles.status} role="status">{finished ? 'Ready to explore' : !sceneReady ? 'Preparing your world' : 'Every leg. One journey.'}</p>
    <div className={styles.escape}>{escape && sceneReady && !finished && <button type="button" onClick={enter}>Enter website <span aria-hidden="true">↗</span></button>}</div>
  </div>;
}
