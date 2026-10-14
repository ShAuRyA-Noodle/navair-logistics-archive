import type { Metadata } from 'next';
import Link from 'next/link';
// Plane film retired from the homepage (kept in the repo with its assets): the Navair
// scroll sequence below replaces it. To restore, re-enable this import and <SceneOne />.
// import { SceneOne } from '@/components/SceneOne';
import { GlobeHero } from '@/components/globe/GlobeHero';
import { NavairSequence } from '@/navair/ui/NavairSequence';
import NavairChat from '@/components/NavairChat';
import '@fontsource-variable/space-grotesk';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import styles from './landing.module.css';
import 'lenis/dist/lenis.css';

export const metadata: Metadata = {
  title: 'Navair Logistics — Distance deserves direction.',
  description: 'Tell us what is moving, where it is going and when it needs to arrive. Start your freight enquiry with Navair Logistics.',
};

export default function Home() {
  return <div className={styles.home}>
    <GlobeHero />
    {/* <SceneOne /> — plane video film, commented out: replaced by the Navair sequence. */}
    <NavairSequence />
    <NavairChat />
    <footer className={styles.footer}><Link href="/" className={styles.footerBrand}>NAVAIR</Link><p>Global movement. Personal responsibility.</p><a href="#enquiry">START AN ENQUIRY ↗</a><small>Globe routes are illustrative. Country data: <a href="https://github.com/mledoze/countries">mledoze/countries</a> · <a href="/licenses/countries.txt">ODbL 1.0</a></small></footer>
  </div>;
}
