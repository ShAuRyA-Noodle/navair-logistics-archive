import type { Metadata } from 'next';
import Link from 'next/link';
import { GlobeHero } from '@/components/globe/GlobeHero';
import '@fontsource-variable/space-grotesk';
import '@fontsource/ibm-plex-mono/400.css';
import styles from './landing.module.css';

export const metadata: Metadata = {
  title: 'Navair Logistics — Distance deserves direction.',
  description: 'Tell us what is moving, where it is going and when it needs to arrive. Start your freight enquiry with Navair Logistics.',
};

const services = [
  ['Air freight', 'Start with your route, timing and shipment details.'],
  ['Sea freight', 'Tell us about your cargo and planned ocean movement.'],
  ['Road freight', 'Share the collection and delivery points for your enquiry.'],
  ['Courier', 'Outline your parcel, destination and required arrival date.'],
];

export default function Home() {
  return <div className={styles.home}>
    <GlobeHero />
    <section className={styles.approach} id="approach" aria-labelledby="approach-heading">
      <p className={styles.kicker}>THE NAVAIR APPROACH</p>
      <h2 id="approach-heading">THE WORLD IS<br />COMPLICATED.<br /><span>LET’S FIND<br />YOUR WAY.</span></h2>
      <div className={styles.approachCopy}><p>Every journey starts with the right questions.</p><p>Share your origin, destination and cargo details. Our enquiry process brings the essentials together so your next conversation starts with context.</p><Link href="/first-time-exporter">START A CONVERSATION <span aria-hidden="true">↗</span></Link></div>
    </section>
    <section className={styles.services} id="services" tabIndex={-1} aria-labelledby="services-heading">
      <div className={styles.sectionIntro}><p className={styles.kicker}>FREIGHT ENQUIRIES</p><h2 id="services-heading">WHAT’S YOUR<br />NEXT MOVE?</h2><p>Explore the starting points below. Service availability and route requirements are confirmed during your enquiry.</p></div>
      <div className={styles.serviceGrid}>{services.map(([name, description], i) => <Link href="/first-time-exporter" key={name}><span className={styles.serviceNumber}>0{i + 1}</span><h3>{name}<span aria-hidden="true">↗</span></h3><p>{description}</p></Link>)}</div>
    </section>
    <footer className={styles.footer}><Link href="/" className={styles.footerBrand}>NAVAIR ↗</Link><p>Global movement. Personal responsibility.</p><Link href="/first-time-exporter">START AN ENQUIRY ↗</Link><small>Globe routes are illustrative.</small></footer>
  </div>;
}
