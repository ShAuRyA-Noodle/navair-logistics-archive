import Link from 'next/link';
import styles from './landing.module.css';

const services = [
  ['Air freight', 'Time-sensitive shipments and airport-to-airport coordination.'],
  ['Sea freight', 'Planned ocean movements for larger or less urgent cargo.'],
  ['Road freight', 'Regional delivery planning between cities and distribution points.'],
  ['Courier', 'Smaller consignments that need a direct handover.'],
];

export default function Home() {
  return <div className={styles.home}>
    <section className={styles.hero}>
      <div><p className="eyebrow">Navair logistics</p><h1>Start with the route. We’ll help shape the move.</h1><p className={styles.lead}>For first-time exporters, a clear freight enquiry is the fastest way to get the right questions, route context, and next steps in one place.</p><div className={styles.actions}><Link className="button-link" href="/first-time-exporter">Start an enquiry</Link><Link className={styles.secondaryAction} href="/forecast">Explore route forecasts</Link></div></div>
      <aside className={styles.heroPanel} aria-label="How an enquiry works"><p className="eyebrow">Before you book</p><h2>Share the essentials</h2><p>Choose the origin and destination first. The form will surface any available recent route conditions while you fill in the shipment details.</p></aside>
    </section>
    <section className={styles.services} aria-labelledby="services-heading"><div className={styles.sectionIntro}><p className="eyebrow">Freight services</p><h2 id="services-heading">A practical starting point for each kind of move.</h2></div><div className={styles.serviceGrid}>{services.map(([name, description]) => <article key={name}><h3>{name}</h3><p>{description}</p></article>)}</div></section>
    <section className={styles.process} aria-labelledby="process-heading"><div className={styles.sectionIntro}><p className="eyebrow">The enquiry process</p><h2 id="process-heading">Three steps to a considered shipment plan.</h2></div><ol>{[['01', 'Set the route', 'Add the origin, destination, and service that best fits the shipment.'], ['02', 'Add the shipment', 'Tell us what is moving, when it is needed, and any handling requirements.'], ['03', 'Receive next steps', 'Our operations team reviews the request and follows up from the workspace.']].map(([number, title, description]) => <li key={number}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol></section>
  </div>;
}
