import type { Metadata } from 'next';
import Link from 'next/link';
import { GlobeHero } from '@/components/globe/GlobeHero';
import '@fontsource-variable/space-grotesk';
import '@fontsource/ibm-plex-mono/400.css';
import styles from './landing.module.css';
import 'lenis/dist/lenis.css';

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
    <section className={styles.services} id="services" tabIndex={-1} aria-labelledby="services-heading">
      <div className={styles.sectionIntro}><p className={styles.kicker}>FREIGHT ENQUIRIES</p><h2 id="services-heading">WHAT’S YOUR<br />NEXT MOVE?</h2><p>Explore the starting points below. Service availability and route requirements are confirmed during your enquiry.</p></div>
      <div className={styles.serviceGrid}>{services.map(([name, description], i) => <Link href="/first-time-exporter" key={name}><span className={styles.serviceNumber}>0{i + 1}</span><h3>{name}<span aria-hidden="true">↗</span></h3><p>{description}</p></Link>)}</div>
    </section>
    <footer className={styles.footer}><Link href="/" className={styles.footerBrand}>NAVAIR</Link><p>Global movement. Personal responsibility.</p><Link href="/first-time-exporter">START AN ENQUIRY ↗</Link><small>Globe routes are illustrative. Country data: <a href="https://github.com/mledoze/countries">mledoze/countries</a> · <a href="/licenses/countries.txt">ODbL 1.0</a></small></footer>
  </div>;
}
