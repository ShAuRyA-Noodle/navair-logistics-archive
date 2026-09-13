import type { Metadata } from 'next';
import { Header } from '@/components/header';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/inter';
import '@fontsource/open-sauce-sans/400.css';
import '@fontsource/open-sauce-sans/500.css';
import '@fontsource/open-sauce-sans/600.css';
import './globals.css';

export const metadata: Metadata = { title: 'Navair Logistics', description: 'Navair logistics operations workspace' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Header /><main>{children}</main></body></html>;
}
