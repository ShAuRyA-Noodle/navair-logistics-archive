import type { Metadata } from 'next';
import Link from 'next/link';
import { FirstTimeExporterForm } from '@/components/first-time-exporter-form';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'First-time exporter enquiry | Navair Logistics', description: 'A guided freight enquiry for first-time exporters.' };

export default function FirstTimeExporterPage() {
  return <div className={styles.page}><Link className={styles.back} href="/">Back to Navair home</Link><header className={styles.intro}><p className="eyebrow">First-time exporter</p><h1>Tell us the essentials. We’ll help with the rest.</h1><p>Start your freight enquiry without freight jargon. Choose “not sure yet” wherever you need to.</p></header><FirstTimeExporterForm /></div>;
}
