'use client';

import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import interactionStyles from './animated-cta.module.css';
import styles from './globe-hero.module.css';

/** A restrained magnetic response with a rolling label and travelling arrow. */
export function AnimatedCta({ children, href, onClick, secondary = false, className = '' }: {
  children: ReactNode; href?: string; onClick?: () => void; secondary?: boolean; className?: string;
}) {
  const reduced = useReducedMotion();
  const bounds = useRef<DOMRect | null>(null);
  const limits = useRef({ x: 0, y: 0 });
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 210, damping: 26, mass: 0.55 });
  const springY = useSpring(y, { stiffness: 210, damping: 26, mass: 0.55 });

  function reset() {
    bounds.current = null;
    limits.current = { x: 0, y: 0 };
    x.set(0);
    y.set(0);
  }

  useEffect(() => {
    if (reduced) reset();
  }, [reduced]);

  function move(event: PointerEvent<HTMLElement>) {
    if (reduced || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return;
    const rect = bounds.current ?? event.currentTarget.getBoundingClientRect();
    const horizontal = (event.clientX - rect.left) / rect.width - 0.5;
    const vertical = (event.clientY - rect.top) / rect.height - 0.5;
    x.set(Math.max(-limits.current.x, Math.min(limits.current.x, horizontal * limits.current.x * 2)));
    y.set(Math.max(-limits.current.y, Math.min(limits.current.y, vertical * limits.current.y * 2)));
  }

  const props = {
    className: `${styles.animatedCta} ${secondary ? styles.animatedCtaSecondary : ''} ${className}`,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (!reduced && (event.pointerType === 'mouse' || event.pointerType === 'pen')) {
        bounds.current = event.currentTarget.getBoundingClientRect();
        const computed = getComputedStyle(event.currentTarget);
        const horizontalInset = Math.min(parseFloat(computed.paddingLeft), parseFloat(computed.paddingRight));
        const verticalInset = Math.min(parseFloat(computed.paddingTop), parseFloat(computed.paddingBottom));
        limits.current = {
          x: Math.max(0, horizontalInset - 2),
          y: Math.max(0, verticalInset - 2),
        };
      }
    },
    onPointerMove: move,
    onPointerLeave: reset,
    onPointerCancel: reset,
    onBlur: reset,
    whileTap: reduced ? undefined : { scale: 0.975 },
  };
  const content = <motion.span className={interactionStyles.magneticInner} style={reduced ? undefined : { x: springX, y: springY }}><span className={styles.ctaLabel}><span>{children}</span><span aria-hidden="true">{children}</span></span><span className={styles.ctaArrow} aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg><svg viewBox="0 0 20 20" fill="none"><path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg></span></motion.span>;
  return href ? <motion.a {...props} href={href}>{content}</motion.a> : <motion.button {...props} type="button" onClick={onClick}>{content}</motion.button>;
}
