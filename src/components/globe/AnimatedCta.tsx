'use client';

import { motion, useMotionValue, useSpring, useReducedMotion } from 'motion/react';
import type { MouseEvent, ReactNode } from 'react';
import styles from './globe-hero.module.css';

/** A restrained magnetic response with a rolling label and travelling arrow. */
export function AnimatedCta({ children, href, onClick, secondary = false, className = '' }: {
  children: ReactNode; href?: string; onClick?: () => void; secondary?: boolean; className?: string;
}) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0), y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 260, damping: 24 });
  const springY = useSpring(y, { stiffness: 260, damping: 24 });
  function move(event: MouseEvent<HTMLElement>) {
    if (reduced || !matchMedia('(pointer:fine)').matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - bounds.left - bounds.width / 2) * 0.07);
    y.set((event.clientY - bounds.top - bounds.height / 2) * 0.13);
  }
  const props = {
    className: `${styles.animatedCta} ${secondary ? styles.animatedCtaSecondary : ''} ${className}`,
    style: { x: springX, y: springY },
    onMouseMove: move,
    onMouseLeave: () => { x.set(0); y.set(0); },
    whileTap: reduced ? undefined : { scale: 0.975 },
  };
  const content = <><span className={styles.ctaLabel}><span>{children}</span><span aria-hidden="true">{children}</span></span><span className={styles.ctaArrow} aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg><svg viewBox="0 0 20 20" fill="none"><path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg></span></>;
  return href ? <motion.a {...props} href={href}>{content}</motion.a> : <motion.button {...props} type="button" onClick={onClick}>{content}</motion.button>;
}
