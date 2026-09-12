'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage, formatDate } from './api';
import { Loading, Notice } from './notice';
import type { EventDetail, FeedCard, FeedPage, ImpactDetail } from '@/lib/news/feed';
import './trade-feed.css';

// The feed reads as a briefing, not an article. Bullets, highlighted figures, and the
// corridor named up front, because a reader only cares whether it touches their cargo.

const SEVERITY_WORDS: Record<string, string> = {
  severe: 'Severe', elevated: 'Elevated', watch: 'Watch', none: 'No effect',
};
const TOPIC_WORDS: Record<string, string> = {
  chokepoint: 'Chokepoint', tariff: 'Tariffs', sanctions: 'Sanctions', conflict: 'Conflict',
  port_disruption: 'Ports', carrier_capacity: 'Capacity', export_control: 'Export controls',
  customs_policy: 'Customs', energy: 'Energy', trade_agreement: 'Trade deals',
  labour: 'Strikes', weather: 'Weather', infrastructure: 'Infrastructure',
  regulation: 'Rules', currency: 'Currency', commodity: 'Commodities',
  security: 'Security', biosecurity: 'Biosecurity', cyber: 'Cyber', india_policy: 'India policy',
};

// Day headings, so the feed reads as a record rather than a pile. "Today" and "Yesterday"
// because that is how people talk about news.
function dayHeading(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const days = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const REGION_WORDS: Record<string, string> = {
  gulf: 'Gulf', europe: 'Europe', sea_asia: 'SE Asia', east_asia: 'East Asia',
  americas: 'Americas', india: 'India',
};

function corridorWords(corridor: string) {
  const [region, mode] = corridor.split('-');
  return `${REGION_WORDS[region] ?? region} · ${mode}`;
}

// The model marks the few terms worth the reader's eye with **double asterisks**.
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((part, index) => (part.startsWith('**') && part.endsWith('**')
    ? <mark key={index}>{part.slice(2, -2)}</mark>
    : <span key={index}>{part}</span>))}</>;
}

function Impact({ impact }: { impact: ImpactDetail }) {
  return <article className={`tf-impact tf-sev-${impact.severity}`}>
    <header>
      <span className="tf-corridor">{corridorWords(impact.corridor)}</span>
      <span className={`tf-badge tf-badge-${impact.severity}`}>{SEVERITY_WORDS[impact.severity]}</span>
    </header>
    <h4>{impact.headline}</h4>

    {impact.keyNumbers.length > 0 && <dl className="tf-numbers">
      {impact.keyNumbers.map((number) => <div key={`${number.label}-${number.value}`}>
        <dt>{number.label}</dt>
        <dd>{number.value}</dd>
        <small>{number.source}</small>
      </div>)}
    </dl>}

    <ul className="tf-bullets">
      {impact.bullets.map((bullet, index) => <li key={index}><Highlighted text={bullet} /></li>)}
    </ul>

    {impact.outlook.length > 0 && <div className="tf-outlook">
      <p className="tf-label">What to expect next</p>
      <ul>{impact.outlook.map((line, index) => <li key={index}><Highlighted text={line} /></li>)}</ul>
    </div>}

    {impact.actions.length > 0 && <div className="tf-actions">
      <p className="tf-label">Do this week</p>
      <ul>{impact.actions.map((action, index) => <li key={index}><Highlighted text={action} /></li>)}</ul>
    </div>}

    <footer>
      Confidence {impact.confidence} · written by {impact.model} from the sources below · operational guidance only, never a price or rate forecast
    </footer>
  </article>;
}

function Card({ card }: { card: FeedCard }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || detail) return;
    setLoading(true);
    try {
      setDetail(await api<EventDetail>(`/api/news/${encodeURIComponent(card.slug)}`));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  const severity = card.severity ?? 'none';
  return <section className={`tf-card tf-sev-${severity}`}>
    <div className="tf-card-head">
      <div className="tf-meta">
        {card.severity && <span className={`tf-badge tf-badge-${severity}`}>{SEVERITY_WORDS[severity]}</span>}
        <span className="tf-importance" title="How much this matters, 1 to 10">{card.importance}/10</span>
        {card.topics.slice(0, 3).map((topic) => <span className="tf-chip" key={topic}>{TOPIC_WORDS[topic] ?? topic}</span>)}
        <span className="tf-when">{formatDate(card.lastSeen)}</span>
      </div>
      <h3>{card.title}</h3>
      {card.indiaNote
        ? <p className="tf-india"><span className="tf-india-tag">India</span> <Highlighted text={card.indiaNote} /></p>
        : card.teaser ? <p className="tf-teaser"><Highlighted text={card.teaser} /></p>
        : <p className="tf-teaser tf-muted">{card.summary}</p>}
      {card.indiaNote && card.teaser && <p className="tf-teaser"><Highlighted text={card.teaser} /></p>}
      <p className="tf-routes">
        {card.corridors.length > 0
          ? <>Affects <strong>{card.corridors.map(corridorWords).join(', ')}</strong></>
          : 'No Navair corridor affected'}
        {card.sourceCount > 0 && <> · {card.sourceCount} source{card.sourceCount === 1 ? '' : 's'}</>}
      </p>
      <button type="button" onClick={() => void toggle()} aria-expanded={open}>
        {open ? 'Close' : card.corridorCount > 0 ? `Read the analysis (${card.corridorCount} corridor${card.corridorCount === 1 ? '' : 's'})` : 'See the sources'}
      </button>
    </div>

    {open && <div className="tf-detail">
      {loading && <Loading label="Opening the briefing" />}
      {error && <Notice>{error}</Notice>}
      {detail && <>
        {/* Only reachable when NEWS_PUBLIC_ANALYSIS is off; the demo runs it on. */}
        {detail.locked && <div className="tf-locked">
          <p><strong>The full analysis is for account holders.</strong> You are seeing the summary above.</p>
          <div className="tf-locked-actions">
            <Link className="button-link tf-ghost" href="/first-time-exporter">Send an enquiry</Link>
          </div>
        </div>}
        {detail.impacts.map((impact) => <Impact impact={impact} key={impact.corridor} />)}
        {detail.sources.length > 0 && <div className="tf-sources">
          <p className="tf-label">Sources</p>
          <ul>
            {detail.sources.map((source) => <li key={`${source.sourceKey}-${source.title}`}>
              {source.url ? <a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a> : source.title}
              <small>{source.sourceKey.replace(/^gdelt:|^newsapi:/, '')} · {formatDate(source.publishedAt)}</small>
            </li>)}
          </ul>
        </div>}
      </>}
    </div>}
  </section>;
}

export function TradeFeed() {
  const [page, setPage] = useState<FeedPage | null>(null);
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topic, setTopic] = useState<string>('all');

  const PAGE = 40;
  const load = useCallback(async (offset: number) => {
    const result = await api<FeedPage>(`/api/news?limit=${PAGE}&offset=${offset}`);
    setPage(result);
    setCards((current) => (offset === 0 ? result.events : [...current, ...result.events]));
  }, []);

  useEffect(() => {
    void load(0).catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false));
  }, [load]);

  async function loadMore() {
    if (!page) return;
    setLoadingMore(true);
    try {
      await load(page.offset + page.limit);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoadingMore(false);
    }
  }

  const topics = [...new Set(cards.flatMap((card) => card.topics))].sort();
  const shown = topic === 'all' ? cards : cards.filter((card) => card.topics.includes(topic));
  const hasMore = Boolean(page && cards.length < page.total);

  // Group by day so nothing is lost simply because something newer arrived.
  const days: Array<[string, FeedCard[]]> = [];
  for (const card of shown) {
    const heading = dayHeading(card.lastSeen);
    const bucket = days.find(([label]) => label === heading);
    if (bucket) bucket[1].push(card);
    else days.push([heading, [card]]);
  }

  return <div className="page-shell tf-shell">
    <div className="page-title">
      <div><p className="eyebrow">Trade disruption watch</p><h1>What is moving in the world, and what it does to your cargo</h1></div>
      <p>Navair watches chokepoints, tariffs, strikes, weather, sanctions and policy, then works out what each one changes for the corridors it ships on. Every item carries a note on what it means for India. Sourced, kept on the record, and never a price prediction.</p>
    </div>

    {error && <Notice>{error}</Notice>}
    {loading && <Loading label="Loading the watch list" />}

    {!loading && cards.length === 0 && <div className="empty">
      Nothing has cleared the relevance bar yet. The next sweep will fill this page.
    </div>}

    {page && page.total > 0 && <p className="tf-count">
      {page.total} event{page.total === 1 ? '' : 's'} on the record · showing {shown.length}
    </p>}

    {topics.length > 1 && <div className="tf-filters">
      <button type="button" className={topic === 'all' ? 'tf-filter tf-filter-on' : 'tf-filter'} onClick={() => setTopic('all')}>Everything</button>
      {topics.map((value) => <button type="button" key={value}
        className={topic === value ? 'tf-filter tf-filter-on' : 'tf-filter'}
        onClick={() => setTopic(value)}>{TOPIC_WORDS[value] ?? value}</button>)}
    </div>}

    {days.map(([heading, group]) => <section className="tf-day" key={heading}>
      <h2 className="tf-day-heading">{heading}<span>{group.length} item{group.length === 1 ? '' : 's'}</span></h2>
      <div className="tf-list">{group.map((card) => <Card card={card} key={card.slug} />)}</div>
    </section>)}

    {hasMore && <button type="button" className="tf-more" onClick={() => void loadMore()} disabled={loadingMore}>
      {loadingMore ? 'Loading…' : `Show earlier news (${(page?.total ?? 0) - cards.length} more)`}
    </button>}
  </div>;
}
