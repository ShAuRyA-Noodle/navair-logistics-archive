import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ForecastChart } from '../src/components/forecast-chart';
import type { Forecast } from '../src/components/types';

const historyOnly: Forecast = {
  status: 'insufficient_data', isDemo: true, label: 'Observed route history', reason: 'More data is needed.', currency: 'INR', unit: 'kg', confidence: 80, weeks: 1,
  history: [{ date: '2026-01-05', price: 120 }, { date: '2026-01-26', price: 135 }], points: [], referencePrice: 135, changePercent: null,
  metrics: { mae: null, coverage: null, backtestCount: 0 }, dataThrough: '2026-01-26',
};

describe('ForecastChart', () => {
  it('renders historical evidence without a future legend or projection', () => {
    const markup = renderToStaticMarkup(<ForecastChart data={historyOnly} />);
    expect(markup).toContain('Observed selling price');
    expect(markup).not.toContain('Projected price');
    expect(markup).toContain('Date · 2026');
  });

  it('renders a visible uncertainty whisker for a one-week projection', () => {
    const markup = renderToStaticMarkup(<ForecastChart data={{ ...historyOnly, status: 'available', points: [{ week: 1, date: '2026-02-02', estimate: 140, lower: 130, upper: 150 }] }} />);
    expect(markup).toContain('forecast-whisker');
  });
});
