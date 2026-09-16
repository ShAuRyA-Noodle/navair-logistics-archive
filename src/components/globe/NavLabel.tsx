import type {CSSProperties} from 'react';
import styles from './nav-label.module.css';

/** Both animated rows are decorative; assistive technology reads the label once. */
export function NavLabel({text}: {text: string}) {
  return <><span className={styles.accessible}>{text}</span><span className={styles.window} aria-hidden="true">
    {[0, 1].map(row => <span key={row} className={`${styles.row} ${row ? styles.incoming : ''}`}>
      {Array.from(text).map((letter, index) => <span className={styles.letter} key={index} style={{'--letter': index} as CSSProperties}>{letter === ' ' ? '\u00a0' : letter}</span>)}
    </span>)}
  </span><svg className={styles.underline} viewBox="0 0 160 12" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M2 9Q65 1 158 5Q96 4 42 10" pathLength="100" /></svg></>;
}
