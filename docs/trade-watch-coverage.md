# Trade watch — coverage checklist

What the sweep is expected to catch, so nothing important is missed quietly. Each topic
lives in `src/lib/news/relevance.ts` with its own match terms and a weight saying how much
it could change a shipment. Adding a topic means adding terms and a corridor mapping there;
no other part of the pipeline needs to know.

## Covered today — 20 topics

| # | Topic | Weight | Catches |
|---|---|---|---|
| 1 | `chokepoint` | 30 | Hormuz, Suez, Bab el-Mandeb, Malacca, Panama, Good Hope, Bosporus |
| 2 | `conflict` | 22 | War, blockade, missile and naval action, attacks on shipping |
| 3 | `sanctions` | 20 | Embargoes, entity lists, asset freezes, OFAC action |
| 4 | `tariff` | 20 | Duties, anti-dumping, countervailing, Section 301, safeguards |
| 5 | `export_control` | 18 | Export bans, licence requirements, quotas, rare earths |
| 6 | `port_disruption` | 16 | Port and terminal closures, congestion, customs stoppages |
| 7 | `security` | 16 | Piracy, hijacking, cargo theft, convoys, war-risk areas |
| 8 | `carrier_capacity` | 14 | Blank sailings, capacity cuts, diversions, container shortages |
| 9 | `labour` | 14 | Dock, driver, pilot and customs strikes; staff shortages |
| 10 | `weather` | 14 | Cyclones, monsoon, fog, floods, low water, earthquakes |
| 11 | `customs_policy` | 12 | Clearance rules, inspection regimes, trade facilitation |
| 12 | `india_policy` | 12 | DGFT notifications, RoDTEP, drawback, SEZ, PLI, BIS, budget |
| 13 | `biosecurity` | 12 | Quarantine, phytosanitary rules, outbreaks, fumigation |
| 14 | `commodity` | 11 | Grain, sugar, steel, semiconductor, fertiliser, edible oil supply |
| 15 | `cyber` | 11 | Ransomware and IT outages at ports, carriers and customs |
| 16 | `trade_agreement` | 11 | FTAs, CEPA, RCEP, rules of origin, preferential access |
| 17 | `regulation` | 10 | IMO rules, CBAM, sulphur cap, labelling and packaging rules |
| 18 | `energy` | 10 | Crude, bunker and jet fuel, OPEC decisions, energy shortage |
| 19 | `currency` | 9 | Rupee moves, capital controls, payment and LC restrictions |
| 20 | `infrastructure` | 8 | New terminals, freight corridors, ICDs, canal draft limits |

## Every event gets an India note

Regardless of score, each event is given one or two plain sentences on what it means for
Indian trade, written by the model and held to the same rules as everything else: no
prices, no market calls, nothing the sources do not support. Events scoring at or above the
major threshold additionally get a full per-corridor briefing with bullets, sourced figures,
outlook and actions.

This is the point of the two tiers: a minor customs circular still says something useful in
one line, instead of being dropped for scoring low.

## Nothing is deleted

- Events stay on the record permanently. Nothing is removed by a later sweep.
- After 30 days an event is marked `archived`. That is a label meaning "older", not hidden -
  it still appears in the feed under its own date.
- The feed reads newest first and paginates. It used to order by importance and cut the list
  at a fixed limit, which made older items appear to vanish whenever a big story landed.

## Worth adding next

Candidates, roughly in order of value:

1. **Indian government primary sources** - PIB releases, DGFT notifications, CBIC circulars.
   Today India policy is caught only when a newsroom writes about it.
2. **EU and UK official journals** - the European equivalents of the Federal Register.
3. **Carrier and port advisories** - Maersk, MSC, Hapag-Lloyd and major port authorities
   publish disruption notices before the press reports them.
4. **Air cargo** - IATA and airport notices; air freight is currently covered only through
   general news.
5. **Rail corridors** - India's dedicated freight corridors and the China-Europe rail link.
6. **Insurance and war-risk bulletins** - Lloyd's listed areas change before rates do.
7. **Local-language Indian sources** - Hindi and regional business press.

## How to add a topic

1. Add the name to the `Topic` union in `relevance.ts`.
2. Add its match terms to `TOPIC_TERMS` - whole words and phrases, lowercase.
3. Give it a weight in `TOPIC_WEIGHT` reflecting how much it can change a shipment.
4. Add a display label to `TOPIC_WORDS` in `trade-feed.tsx`.
5. Add a test in `tests/news-relevance.test.ts` proving a real headline is caught and a
   lookalike is not.
