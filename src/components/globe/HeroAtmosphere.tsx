'use client';

import {useEffect, useRef} from 'react';
import {motion, useMotionValue, useSpring, useReducedMotion} from 'motion/react';
import styles from './globe-hero.module.css';

/** Decorative layers move independently of the finalized globe renderer. */
export function HeroAtmosphere() {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const x = useMotionValue(0), y = useMotionValue(0);
  const sx = useSpring(x, {stiffness: 35, damping: 22});
  const sy = useSpring(y, {stiffness: 35, damping: 22});
  useEffect(() => {
    const stage = host.current?.parentElement;
    if (!stage || reduced || !matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    const move = (event: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      x.set((event.clientX / rect.width - .5) * -12);
      y.set(((event.clientY - rect.top) / rect.height - .5) * -10);
    };
    const reset = () => { x.set(0); y.set(0); };
    stage.addEventListener('pointermove', move, {passive: true});
    stage.addEventListener('pointerleave', reset);
    return () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerleave', reset); reset(); };
  }, [reduced, x, y]);
  return <div className={styles.space} ref={host} aria-hidden="true">
    <motion.div className={styles.atmosphereLayers} style={{x: sx, y: sy}}>
      <div className={styles.nebula} /><div className={styles.starfield} /><div className={styles.horizon} />
      <svg className={styles.orbitalLines} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" fill="none">
        <defs><linearGradient id="navair-orbit-light"><stop stopColor="#94bfff" stopOpacity="0"/><stop offset=".55" stopColor="#94bfff" stopOpacity=".45"/><stop offset="1" stopColor="#ddbd77" stopOpacity=".65"/></linearGradient></defs>
        <ellipse cx="1100" cy="520" rx="750" ry="290" transform="rotate(-28 1100 520)" stroke="url(#navair-orbit-light)" strokeWidth=".7"/>
        <ellipse cx="1100" cy="520" rx="830" ry="330" transform="rotate(-28 1100 520)" stroke="#8db7e8" strokeOpacity=".1" strokeWidth=".6" strokeDasharray="2 14"/>
        <path d="M430 890 1510 160" stroke="#cde7ff" strokeOpacity=".09" strokeDasharray="2 12"/>
      </svg>
    </motion.div>
    <div className={styles.readingShade} />
  </div>;
}
