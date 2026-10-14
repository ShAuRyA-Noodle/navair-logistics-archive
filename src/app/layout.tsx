import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Header } from '@/components/header';
import '@fontsource-variable/archivo';
import '@fontsource-variable/inter';
import './globals.css';

// Open Sauce Sans is self-hosted through next/font: preloaded, font-display swap and a
// metric-matched fallback (no layout shift). The fontsource 400 woff2 ships a Type 1
// file that browsers reject (OTS "invalid sfntVersion"), so 400 uses the valid woff.
// Montserrat was dropped: --font-heading resolves to Archivo everywhere.
const openSauce = localFont({
  src: [
    { path: './fonts/open-sauce-sans-latin-400-normal.woff', weight: '400', style: 'normal' },
    { path: './fonts/open-sauce-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/open-sauce-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-open-sauce',
  fallback: ['Arial', 'Helvetica', 'sans-serif'],
});

export const metadata: Metadata = { title: 'Navair Logistics', description: 'Navair logistics operations workspace' };
export const viewport: Viewport = { themeColor: '#101f38', colorScheme: 'light' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={openSauce.variable}><body><Header /><main>{children}</main></body></html>;
}
