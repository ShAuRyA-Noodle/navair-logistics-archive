import {describe,it,expect} from 'vitest';
import {classify,isWorthKeeping,importanceOf,type RawItem,type Topic} from '../src/lib/news/relevance';
import {clusterItems,similarity} from '../src/lib/news/clustering';
import {auditNote} from '../src/lib/news/analysis';

const item = (title: string, summary: string | null = null, extra: Partial<RawItem> = {}): RawItem => ({
  sourceKey: 'test', externalId: title, url: null, title, summary,
  publishedAt: '2026-09-11T00:00:00.000Z', trust: 4, ...extra,
});
const score = (title: string, summary?: string | null, extra?: Partial<RawItem>) => classify(item(title, summary ?? null, extra));

describe('what earns a place in the feed', () => {
  it('keeps a chokepoint disruption and routes it to the corridors it sits on', () => {
    const result = score('Strait of Hormuz tanker traffic halves after naval escalation', 'Shipping lines pause Gulf transits.');
    expect(isWorthKeeping(result)).toBe(true);
    expect(result.topics).toContain('chokepoint');
    expect(result.chokepoints).toContain('hormuz');
    expect(result.corridors).toContain('gulf-sea');
  });

  it('sends a Red Sea diversion to Europe lanes, which is where the days are added', () => {
    const result = score('Red Sea diversions push Asia-Europe transit times up', 'Carriers reroute around the Cape of Good Hope, adding days to Europe sailings.');
    expect(isWorthKeeping(result)).toBe(true);
    expect(result.corridors).toContain('europe-sea');
    expect(result.corridors).not.toContain('gulf-sea');
  });

  it('does not read "war" inside "warmwater"', () => {
    const result = score('Certain Frozen Warmwater Shrimp from India: Antidumping Duty Review', 'Duty rates on shrimp imports from India.');
    expect(result.topics).toContain('tariff');
    expect(result.topics).not.toContain('conflict');
  });

  it('still matches a plural, so "sanction" finds "Sanctions Regulations"', () => {
    const result = score('Iranian Transactions and Sanctions Regulations', 'Amendments to sanctions affecting Iranian trade and shipping.');
    expect(result.topics).toContain('sanctions');
    expect(result.regions).toContain('gulf');
    expect(isWorthKeeping(result)).toBe(true);
  });

  it('drops an unrelated story that happens to share a word', () => {
    const result = score('Local council debates warmwater swimming pool refurbishment', 'A leisure centre upgrade.');
    expect(result.topics).toEqual([]);
    expect(isWorthKeeping(result)).toBe(false);
  });

  it('drops a regulatory notice that was filed under a trade term but is not about trade', () => {
    const result = score('In Situ Recovery Monitoring and Decommissioning Timeliness', 'Nuclear regulatory guidance on uranium recovery facilities.', { topicHints: ['export_control'] as Topic[] });
    expect(isWorthKeeping(result)).toBe(false);
  });

  it('trusts a declared topic once the text also reads like trade and names a destination', () => {
    const result = score('Polyethylene Terephthalate Resin From Oman: Amended Final Results', 'Revised duty rates on imports of resin from Oman into the United States.', { topicHints: ['tariff'] as Topic[] });
    expect(result.topics).toContain('tariff');
    expect(result.corridors.length).toBeGreaterThan(0);
    expect(isWorthKeeping(result)).toBe(true);
  });

  it('drops a trade action nobody can act on because it names no geography', () => {
    // Without a country there is no corridor, and an item that reaches no customer is
    // noise however officially it was filed.
    const result = score('Amended Final Results of Less Than Fair Value Investigation', 'Revised duty rates on imports of resin.', { topicHints: ['tariff'] as Topic[] });
    expect(result.corridors).toEqual([]);
    expect(isWorthKeeping(result)).toBe(false);
  });

  it('treats a chokepoint measurement as evidence and keeps it without keyword sniffing', () => {
    const result = score('Strait of Hormuz: recorded transits 48% below their ninety-day norm', 'Satellite tracking.', {
      measurement: { chokepoint: 'Strait of Hormuz', changeRatio: -0.48 }, trust: 5,
    });
    expect(isWorthKeeping(result)).toBe(true);
  });

  it('never assigns a corridor to a story with no destination Navair serves', () => {
    const result = score('Domestic wheat procurement policy revised', 'Grain procurement inside the country.');
    expect(result.corridors).toEqual([]);
    expect(isWorthKeeping(result)).toBe(false);
  });

  it('scores a measured, corroborated story above a lone mention', () => {
    const measured = score('Suez transits fall sharply', 'Measured.', { measurement: { changeRatio: -0.4 }, trust: 5 });
    const passing = score('Analyst comments on freight rates', 'A market note.', { trust: 2 });
    expect(measured.relevance).toBeGreaterThan(passing.relevance);
  });
});

describe('clustering many reports into one event', () => {
  const hormuz = [
    score('Strait of Hormuz traffic falls as tensions rise', 'Tankers wait outside the Gulf.'),
    score('Hormuz tensions leave tankers waiting in the Gulf', 'Traffic through the strait falls.'),
    score('Shipping lines pause Strait of Hormuz transits amid tension', 'Gulf traffic falls again.'),
  ];

  it('recognises reports of the same disruption as one event', () => {
    const clusters = clusterItems(hormuz);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].items).toHaveLength(3);
    expect(clusters[0].chokepoints).toContain('hormuz');
  });

  it('keeps genuinely different events apart', () => {
    const clusters = clusterItems([...hormuz, score('Panama Canal raises daily transit slots', 'More bookings available for the canal.')]);
    expect(clusters.length).toBeGreaterThan(1);
  });

  it('scores similarity higher when two stories share a chokepoint', () => {
    expect(similarity(hormuz[0], hormuz[1])).toBeGreaterThan(similarity(hormuz[0], score('Panama Canal raises daily transit slots', 'Canal bookings.')));
  });

  it('leads a cluster with its most authoritative report', () => {
    const clusters = clusterItems([
      score('Rumour of Hormuz closure spreads on social media', 'Unverified chatter about the strait.', { trust: 2 }),
      score('Hormuz transits suspended, says shipping authority', 'Authority confirms suspension of strait transits.', { trust: 5 }),
    ]);
    expect(clusters[0].title).toContain('shipping authority');
  });

  it('raises importance when several independent sources carry the same story', () => {
    const single = importanceOf([score('Suez Canal disruption reported', 'One report.')]);
    const many = importanceOf([
      score('Suez Canal disruption reported', 'Report one.', { sourceKey: 'a' }),
      score('Suez Canal disruption confirmed', 'Report two.', { sourceKey: 'b' }),
      score('Suez Canal disruption widens', 'Report three.', { sourceKey: 'c' }),
      score('Suez Canal disruption continues', 'Report four.', { sourceKey: 'd' }),
    ]);
    expect(many).toBeGreaterThan(single);
  });

  it('never returns an importance outside the one to ten scale', () => {
    expect(importanceOf([])).toBe(1);
    const extreme = importanceOf(Array.from({ length: 40 }, (_, index) =>
      score(`Strait of Hormuz closed completely report ${index}`, 'Measured collapse in transits.', { sourceKey: `s${index}`, trust: 5, measurement: { changeRatio: -0.9 } })));
    expect(extreme).toBeLessThanOrEqual(10);
    expect(extreme).toBeGreaterThanOrEqual(1);
  });
});

describe('the India note guard', () => {
  it('sees through the highlight markers the model writes', () => {
    // "**" between the words used to hide the claim from a pattern expecting a space.
    expect(auditNote('Lower **oil prices** could ease costs for Indian **energy imports**.')).not.toBeNull();
    expect(auditNote('Higher **oil prices** mean more fuel costs for shipping.')).not.toBeNull();
  });

  it('catches a cost claim whichever way round it is phrased', () => {
    expect(auditNote('Costs will rise for exporters.')).not.toBeNull();
    expect(auditNote('This could raise costs for exporters.')).not.toBeNull();
    expect(auditNote('Higher oil prices mean more freight costs.')).not.toBeNull();
  });

  it('allows an observed macro figure to be explained, which is not a freight quote', () => {
    // Refusing this left the model unable to write an honest note about an oil-price event.
    expect(auditNote("Higher oil prices raise India's import bill and tighten the budget.")).toBeNull();
    expect(auditNote('Oil settled above US$100 this week, which weighs on fuel-intensive exporters.')).toBeNull();
  });

  it('still allows a sourced macro figure, which is evidence rather than a forecast', () => {
    expect(auditNote('India exported about US$33.0 billion of goods to the UAE in 2023 (UN Comtrade).')).toBeNull();
    expect(auditNote('The UAE applied an average MFN tariff of 4.8% in 2021 (WTO).')).toBeNull();
  });

  it('leaves ordinary operational language alone', () => {
    expect(auditNote('Vessels may reroute around the **Cape of Good Hope**, adding days to the sailing.')).toBeNull();
    expect(auditNote('Customs clearance at **Nhava Sheva** could take longer while checks are tightened.')).toBeNull();
  });
});
