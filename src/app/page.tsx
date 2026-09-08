import { EnquiryForm } from '@/components/enquiry-form';

export default function Home() {
  return <div className="page-shell home-shell"><section className="intro"><p className="eyebrow">Navair logistics</p><h1>Freight coordination, with a clear next step.</h1><p>Share the route and shipment requirements. Our operations team will assess the request and follow up from the workspace.</p></section><section id="enquire"><EnquiryForm /></section></div>;
}
