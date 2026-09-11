import type { Metadata } from 'next';
import { TradeFeed } from '@/components/trade-feed';

export const metadata: Metadata = {
  title: 'Trade disruption watch | Navair Logistics',
  description: 'World events that change how cargo moves, and what each one means for Indian export corridors.',
};

export default function NewsPage() {
  return <TradeFeed />;
}
