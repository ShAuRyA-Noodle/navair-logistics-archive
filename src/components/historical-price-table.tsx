'use client';

import { formatDate } from './api';
import type { Forecast } from './types';
import './forecast.css';

export function HistoricalPriceTable({ data }: { data: Forecast }) {
  if (data.history.length === 0) return null;
  return <details className="forecast-history-details"><summary>View {data.history.length} weeks of recorded prices</summary><div className="table-wrap"><table><caption>Observed selling-price history</caption><thead><tr><th scope="col">Date</th><th scope="col">Observed selling price</th></tr></thead><tbody>{data.history.map((item) => <tr key={item.date}><th scope="row">{formatDate(item.date)}</th><td>{data.currency} {item.price.toLocaleString()} / {data.unit}</td></tr>)}</tbody></table></div></details>;
}
