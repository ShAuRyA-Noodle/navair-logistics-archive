// The only file that talks to a language model.
//
// Groq today, something else tomorrow: every call is here, so swapping provider is editing
// this file rather than hunting call sites. The endpoint is OpenAI-compatible, so a move to
// another OpenAI-shaped provider is a base URL and a model id.
//
// Hard rules the prompt enforces and the parser re-checks:
//   - No prices, no rate forecasts, no market calls. The site's price forecast is earned by
//     backtesting and must never be contaminated by a model's opinion.
//   - Every claim rests on the supplied articles and official figures. Nothing invented.
//   - Uncertainty stated plainly, in the words a first-time exporter uses.

import { z } from 'zod';
import { corridorContext, describeContext } from './context';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
// One-line notes do not need the large model, and running them on it burns the shared
// tokens-per-minute allowance that the full briefings need.
const DEFAULT_NOTE_MODEL = 'openai/gpt-oss-20b';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const TIMEOUT_MS = 60_000;

export type AnalysisInput = {
  corridor: string;
  event: { title: string; summary: string; topics: string[]; chokepoints: string[]; importance: number };
  articles: Array<{ title: string; sourceKey: string; url: string | null; publishedAt: string; summary: string | null }>;
  measurements: Array<Record<string, unknown>>;
};

// Scannable, not prose. Bullets carry the findings, keyNumbers carry the figures worth
// showing large, outlook carries the forward view. Every figure must name its source so a
// reader can check it - an unsourced number is the one thing this feature cannot ship.
const schema = z.object({
  severity: z.enum(['none', 'watch', 'elevated', 'severe']),
  headline: z.string().trim().min(8).max(110),
  teaser: z.string().trim().min(20).max(200),
  bullets: z.array(z.string().trim().min(10).max(220)).min(2).max(6),
  keyNumbers: z.array(z.object({
    label: z.string().trim().min(2).max(80),
    value: z.string().trim().min(1).max(40),
    source: z.string().trim().min(2).max(80),
  })).max(4).default([]),
  outlook: z.array(z.string().trim().min(10).max(220)).max(3).default([]),
  actions: z.array(z.string().trim().min(8).max(200)).max(4).default([]),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type Analysis = z.infer<typeof schema> & { model: string; citations: string[]; body: string; corridor?: string };

export class AnalysisUnavailable extends Error {}

const CORRIDOR_WORDS: Record<string, string> = {
  gulf: 'India to the Gulf', europe: 'India to Europe', sea_asia: 'India to South-East Asia',
  east_asia: 'India to East Asia', americas: 'India to the Americas', india: 'domestic Indian freight',
};

function corridorPhrase(corridor: string): string {
  const [region, mode] = corridor.split('-');
  const modeWord = mode === 'sea' ? 'sea freight' : mode === 'air' ? 'air freight' : mode === 'road' ? 'road freight' : 'courier';
  return `${CORRIDOR_WORDS[region] ?? region} by ${modeWord}`;
}

const SYSTEM = [
  'You are a senior trade-disruption analyst at Navair, an Indian freight forwarder. You brief exporters who have never shipped before.',
  'Given one world event and one shipping corridor, say what practically changes for cargo on that corridor.',
  '',
  'Style - this is the whole point, get it right:',
  '- Bullets, never paragraphs. Each bullet is one fact or one consequence, under 25 words.',
  '- Wrap the few genuinely important figures, places and terms in **double asterisks** so the page can highlight them. Two or three per bullet at most. Highlighting everything highlights nothing.',
  '- Plain words a first-time exporter knows. No jargon, no filler, no "it is important to note", no "in the current landscape".',
  '- Every number you state must appear in the material given to you, and keyNumbers must name where it came from.',
  '',
  'Absolute rules:',
  '1. Never state, estimate or imply a price, a freight rate, a cost percentage, or a market direction. Navair publishes its own backtested price forecast; your text must never compete with it.',
  '2. No market, stock or currency predictions. Your forward view covers operations only: space availability, transit time, routing, paperwork, congestion, insurance, planning windows.',
  '3. Invent nothing. No vessel names, no dates, no figures that were not supplied. If the material does not support a claim, leave it out.',
  '4. If the event genuinely does not touch this corridor, answer severity "none" and say so in one or two bullets. That is a correct answer, not a failure.',
  '5. outlook is what to expect next and how likely it is, in operational terms, hedged honestly ("if the closure holds past a week, expect...").',
  '6. Say when evidence is thin. Set confidence "low" rather than writing confidently from one report.',
  '',
  'Return only JSON:',
  '{"severity":"none|watch|elevated|severe",',
  ' "headline":"under 14 words, states the consequence not the event",',
  ' "teaser":"one sentence under 28 words",',
  ' "bullets":["2 to 6 findings, **highlighted** terms"],',
  ' "keyNumbers":[{"label":"what it measures","value":"the figure","source":"who published it"}],',
  ' "outlook":["up to 3 forward-looking operational expectations"],',
  ' "actions":["up to 4 concrete steps an exporter takes this week"],',
  ' "confidence":"low|medium|high"}',
].join('\n');

// Words that mean the model slipped into pricing or market talk despite the rules. Caught
// here rather than trusted, because the whole separation depends on it holding.
// What must never appear is a claim about what shipping will cost. Quoting a sourced
// macro figure - a UN trade value, a WTO tariff rate, an EIA crude price - is the opposite
// of that: it is the evidence the analysis rests on. An earlier blanket ban on "currency
// followed by a digit" got this backwards, blocking a cited Brent price while letting
// "**$37.1 bn**" through, because \b never matches between an asterisk and a dollar sign.
// So the patterns below target freight pricing and cost predictions specifically.
const MONEY = String.raw`(?:inr|usd|rs\.?|us\$|\$|₹)\s?[\d.,]+\s?(?:bn|billion|mn|million|k|lakh|crore)?`;
const FORBIDDEN = [
  /freight rate/i,
  // A money amount tied to a unit of carriage is a quote, whoever is saying it.
  new RegExp(`${MONEY}[^.]{0,40}\\bper\\s?(kg|kilo|kilogram|container|teu|shipment|consignment)\\b`, 'i'),
  new RegExp(`\\bper\\s?(kg|kilo|kilogram|container|teu|shipment|consignment)\\b[^.]{0,40}${MONEY}`, 'i'),
  // A money amount sitting next to freight vocabulary is a freight price.
  new RegExp(`(freight|shipping|haulage|carriage|charter|booking)[^.]{0,30}${MONEY}`, 'i'),
  new RegExp(`${MONEY}[^.]{0,30}(freight|shipping|haulage|carriage|charter|booking)`, 'i'),
  /\d+\s?%\s?(increase|rise|higher|drop|fall|cheaper|more expensive)/i,
  /price(s)? (will|should|could|may) (rise|fall|increase|drop|climb)/i,
  /\bwe (expect|forecast|predict) (prices|rates)/i,
  // Cost language is price language wearing a different coat.
  /(lower|higher|rising|falling|reduced|increased|cheaper|costlier)\s+(shipping|freight|transport|cargo)?\s*(costs?|prices?|rates?|charges?)/i,
  /(costs?|prices?|rates?)\s+(will|may|could|should|are likely to)\s+(rise|fall|increase|drop|climb|ease)/i,
  // The same claim with the verb in front: "could ease costs", "may raise prices".
  /(will|may|could|should|likely to)\s+(ease|raise|lift|cut|reduce|increase|lower|push up|drive up)\s+(the\s+)?(costs?|prices?|rates?|charges?)/i,
  // A claim about what carriage costs. The cost word has to be attached to the carriage:
  // "freight costs", "shipping rates". Naming a commodity move in the same sentence as the
  // word freight is not a price claim - "rising oil prices may tighten air-freight capacity"
  // is about space on aircraft, and refusing it taught the model to avoid the real subject.
  // The test that separates the two: a cost word standing near a carriage word. "More fuel
  // costs for shipping" is a price claim; "tighten air-freight capacity" is not, because
  // capacity is not a cost. Direction alone is not enough, and carriage alone is not either.
  /\b(more|less|extra|added|higher|lower|rising|falling|increased|reduced|cheaper|costlier)\b[^.]{0,40}\b(costs?|rates?|charges?)\b[^.]{0,25}\b(freight|shipping|carriage|haulage|cargo|transport|container|ocean|air)\b/i,
  /\b(freight|shipping|carriage|haulage|cargo|transport|container|ocean|air)\b[^.]{0,25}\b(costs?|rates?|charges?)\b[^.]{0,40}\b(more|less|extra|higher|lower|rising|falling|increase|decrease|rise|fall|climb)\b/i,
  // Third ordering: direction, then the carriage, then the cost - "more freight costs".
  /\b(more|less|extra|added|higher|lower|rising|falling|increased|reduced|cheaper|costlier)\b[^.]{0,40}\b(freight|shipping|carriage|haulage|cargo|transport|container|ocean|air)\b[^.]{0,15}\b(costs?|rates?|charges?)\b/i,
];

// The highlight markers are stripped before checking. Leaving them in let "Lower **oil
// prices** could ease costs" through, because the pattern expected a space where the
// asterisks sat - the same blind spot that once hid "**$37.1 bn**" from the money rule.
function violatesRules(text: string): string | null {
  const plain = text.replace(/\*\*/g, '').replace(/\s+/g, ' ');
  for (const pattern of FORBIDDEN) {
    const hit = pattern.exec(plain);
    if (hit) return hit[0];
  }
  return null;
}

function buildPrompt(input: AnalysisInput, contextLines: string[]): string {
  const articles = input.articles.slice(0, 8).map((article, index) =>
    `[${index + 1}] ${article.title}${article.summary ? ` — ${article.summary.slice(0, 300)}` : ''} (${article.sourceKey}, ${article.publishedAt.slice(0, 10)})`);
  const measurements = input.measurements.map((measurement) => {
    const ratio = typeof measurement.changeRatio === 'number' ? `${Math.round(measurement.changeRatio * 100)}%` : 'unknown';
    const direction = typeof measurement.changeRatio === 'number' && measurement.changeRatio < 0 ? 'FEWER' : 'MORE';
    return `${measurement.chokepoint ?? 'chokepoint'}: the NUMBER OF SHIPS recorded passing through was ${ratio.replace('-', '')} ${direction} than its own 90-day median`
      + ' (IMF PortWatch satellite sample - a consistent sample, not a full count of every ship). This is about how many ships passed, NOT about how fast they travelled.';
  });
  return [
    `Corridor: ${corridorPhrase(input.corridor)}.`,
    `Event: ${input.event.title}`,
    input.event.summary ? `Event summary: ${input.event.summary}` : '',
    input.event.chokepoints.length ? `Chokepoints involved: ${input.event.chokepoints.join(', ')}.` : '',
    '',
    articles.length ? `Reports:\n${articles.join('\n')}` : 'Reports: none supplied.',
    measurements.length ? `\nMeasurements:\n${measurements.join('\n')}` : '',
    contextLines.length ? `\nOfficial background figures:\n${contextLines.join('\n')}` : '',
    '',
    'Brief an exporter on this corridor. Bullets, highlighted key terms, sourced figures. No prices, no rates, no market predictions.',
  ].filter(Boolean).join('\n');
}

// Groq occasionally returns an empty or half-finished generation and rejects its own JSON.
// It is transient, so one retry recovers it; two failures in a row mean something real.
// One call, every affected corridor. Analysing corridors one at a time meant an event
// touching six of them cost six calls, and at a free-tier ceiling of 8,000 tokens a minute
// that is the difference between the whole feed being analysed and a handful of it. The
// model sees all the corridors at once and answers for each, which also makes the answers
// consistent with one another.
const multiSchema = z.object({
  keyNumbers: schema.shape.keyNumbers,
  corridors: z.array(z.object({
    corridor: z.string().trim().min(3).max(40),
    severity: schema.shape.severity,
    headline: schema.shape.headline,
    teaser: schema.shape.teaser,
    bullets: schema.shape.bullets,
    outlook: schema.shape.outlook,
    actions: schema.shape.actions,
    confidence: schema.shape.confidence,
  })).min(1).max(6),
});

export async function analyseEventCorridors(
  input: Omit<AnalysisInput, 'corridor'> & { corridors: string[] },
  attempt = 0,
): Promise<Analysis[]> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new AnalysisUnavailable('GROQ_API_KEY is not configured, so no analysis was generated.');
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const corridors = input.corridors.slice(0, 6);
  const context = await corridorContext(corridors[0] ?? 'gulf-sea');
  const listed = corridors.map((corridor) => `- ${corridor} (${corridorPhrase(corridor)})`).join('\n');
  const prompt = `${buildPrompt({ ...input, corridor: corridors[0] ?? '' }, describeContext(context))}\n\n`
    + `Answer for EACH of these corridors separately, using the exact corridor id given:\n${listed}\n`
    + 'Corridors differ: a sea chokepoint may not touch air freight at all. Say "none" where that is the honest answer.';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let raw: string;
  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model, temperature: 0.2, max_completion_tokens: 8000, reasoning_effort: 'medium',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${SYSTEM}\n\nThis time answer for several corridors at once. Return {"keyNumbers":[...],"corridors":[{"corridor":"<exact id>","severity":...,"headline":...,"teaser":...,"bullets":[...],"outlook":[...],"actions":[...],"confidence":...}]}` },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (response.status === 429 || response.status >= 500) {
      if (attempt < 2) { clearTimeout(timer); await sleep(25_000 * (attempt + 1)); return analyseEventCorridors(input, attempt + 1); }
      throw new AnalysisUnavailable('Groq is rate limiting briefings; the next sweep continues where this one stopped.');
    }
    if (!response.ok) throw new AnalysisUnavailable(`Groq responded ${response.status}: ${(await response.text()).slice(0, 160)}`);
    raw = ((await response.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '';
  } catch (error) {
    if (error instanceof AnalysisUnavailable) throw error;
    if (attempt < 1) { await sleep(3000); return analyseEventCorridors(input, attempt + 1); }
    throw new AnalysisUnavailable(error instanceof Error ? error.message : 'Groq call failed.');
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new AnalysisUnavailable('The model did not return usable JSON.'); }
  const result = multiSchema.safeParse(parsed);
  if (!result.success) throw new AnalysisUnavailable(`The answer did not fit the required shape: ${result.error.issues[0]?.message ?? 'unknown'}`);

  const citations = input.articles.slice(0, 8).map((article) => article.url).filter((url): url is string => Boolean(url));
  // A breach in one corridor discards that corridor, not the whole event.
  return result.data.corridors.flatMap((entry) => {
    const flat = [entry.headline, entry.teaser, ...entry.bullets, ...entry.outlook, ...entry.actions].join(' ');
    if (violatesRules(flat)) return [];
    if (!corridors.includes(entry.corridor)) return [];
    return [{
      ...entry,
      keyNumbers: result.data.keyNumbers,
      model,
      citations,
      body: [...entry.bullets.map((line) => `- ${line.replace(/\*\*/g, '')}`),
        ...(entry.outlook.length ? ['', 'What to expect next:', ...entry.outlook.map((line) => `- ${line.replace(/\*\*/g, '')}`)] : [])].join('\n'),
    } satisfies Analysis];
  });
}

export async function analyseImpact(input: AnalysisInput, attempt = 0): Promise<Analysis> {
  try {
    return await requestAnalysis(input);
  } catch (error) {
    const retryable = error instanceof AnalysisUnavailable
      && /json_validate_failed|json_generate_failed|Groq responded (429|5\d\d)|timed out|did not return usable JSON/.test(error.message);
    if (retryable && attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return analyseImpact(input, attempt + 1);
    }
    throw error;
  }
}

async function requestAnalysis(input: AnalysisInput): Promise<Analysis> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new AnalysisUnavailable('GROQ_API_KEY is not configured, so no analysis was generated.');
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const context = await corridorContext(input.corridor);
  const prompt = buildPrompt(input, describeContext(context));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let raw: string;
  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        // gpt-oss reasons before it answers, and that reasoning is billed against the same
        // budget. A tight cap left nothing for the JSON and Groq rejected the empty
        // generation, so the budget is generous and the reasoning kept short.
        max_completion_tokens: 6000,
        reasoning_effort: 'medium',
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new AnalysisUnavailable(`Groq responded ${response.status}: ${detail.slice(0, 200)}`);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    raw = payload.choices?.[0]?.message?.content ?? '';
  } catch (error) {
    if (error instanceof AnalysisUnavailable) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new AnalysisUnavailable('Groq timed out.');
    throw new AnalysisUnavailable(error instanceof Error ? error.message : 'Groq call failed.');
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AnalysisUnavailable('The model did not return usable JSON.');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new AnalysisUnavailable(`The model's answer did not fit the required shape: ${result.error.issues[0]?.message ?? 'unknown'}`);

  const flat = [result.data.headline, result.data.teaser, ...result.data.bullets, ...result.data.outlook,
    ...result.data.actions, ...result.data.keyNumbers.map((entry) => `${entry.label} ${entry.value}`)].join(' ');
  const breach = violatesRules(flat);
  if (breach) throw new AnalysisUnavailable(`The model wrote about pricing ("${breach}"), which this feature must never do, so the answer was discarded.`);

  // A plain-text rendering is kept alongside the structure so the column stays readable to
  // anything that does not know about bullets.
  const body = [
    ...result.data.bullets.map((line) => `- ${line.replace(/\*\*/g, '')}`),
    ...(result.data.outlook.length ? ['', 'What to expect next:', ...result.data.outlook.map((line) => `- ${line.replace(/\*\*/g, '')}`)] : []),
  ].join('\n');

  return {
    ...result.data,
    body,
    model,
    citations: input.articles.slice(0, 8).map((article) => article.url).filter((url): url is string => Boolean(url)),
  };
}

// Exposed for tests: the refusal rules are the contract, so they are pinned directly.
export const __testing = { violatesRules };


// A one-line India note, written for every event no matter how small. A minor customs
// circular will never justify a full per-corridor briefing, but it should still say what it
// means here rather than sitting in the feed as a bare headline. Short, cheap, and bound by
// the same rule as everything else: no prices, no market calls.
const NOTE_SYSTEM = [
  'You brief Indian exporters and importers at a freight forwarder.',
  'Given one world event, write one or two plain sentences on what it means for Indian trade.',
  '',
  'Rules:',
  '- Under 45 words in total. One idea. No preamble, no throat-clearing.',
  '- Plain English a first-time exporter understands.',
  '- Wrap at most two genuinely important terms in **double asterisks**.',
  '- Never state what shipping or freight costs, and never forecast any price or rate.',
  '- You may repeat an observed, already-published figure (an oil price that has been reported, a trade value, a tariff rate) and say what it means operationally. What you must not do is predict where it goes next or claim what carriage will cost.',
  '- If the honest answer is that it barely touches India, say exactly that in one sentence.',
  '- Claim nothing the material does not support.',
  '',
  'Return only JSON: {"note":"...","relevanceToIndia":"direct|indirect|minimal"}',
].join('\n');

const noteSchema = z.object({
  note: z.string().trim().min(15).max(320),
  relevanceToIndia: z.enum(['direct', 'indirect', 'minimal']),
});
export type IndiaNote = z.infer<typeof noteSchema> & { model: string };

export async function summariseForIndia(input: {
  title: string; summary: string; topics: string[];
  articles: Array<{ title: string; summary: string | null; sourceKey: string }>;
}, attempt = 0): Promise<IndiaNote> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new AnalysisUnavailable('GROQ_API_KEY is not configured, so no India note was written.');
  const model = process.env.GROQ_NOTE_MODEL || DEFAULT_NOTE_MODEL;
  const prompt = [
    `Event: ${input.title}`,
    input.summary ? `Summary: ${input.summary}` : '',
    input.topics.length ? `Topics: ${input.topics.join(', ')}` : '',
    input.articles.slice(0, 4).map((article, index) => `[${index + 1}] ${article.title}${article.summary ? ` — ${article.summary.slice(0, 200)}` : ''}`).join('\n'),
    '',
    'What does this mean for Indian trade? One or two sentences.',
  ].filter(Boolean).join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let raw: string;
  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model, temperature: 0.2, max_completion_tokens: 2000, reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: NOTE_SYSTEM }, { role: 'user', content: prompt }],
      }),
    });
    if (response.status === 429 || response.status >= 500) {
      // The allowance is per minute, so waiting is the whole fix.
      if (attempt < 2) { clearTimeout(timer); await sleep(20_000 * (attempt + 1)); return summariseForIndia(input, attempt + 1); }
      throw new AnalysisUnavailable(`Groq is rate limiting India notes; the next sweep will finish them.`);
    }
    if (!response.ok) throw new AnalysisUnavailable(`Groq responded ${response.status}: ${(await response.text()).slice(0, 160)}`);
    raw = ((await response.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '';
  } catch (error) {
    if (error instanceof AnalysisUnavailable) throw error;
    throw new AnalysisUnavailable(error instanceof Error ? error.message : 'Groq call failed.');
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new AnalysisUnavailable('The model did not return usable JSON for the India note.'); }
  const result = noteSchema.safeParse(parsed);
  if (!result.success) throw new AnalysisUnavailable('The India note did not fit the required shape.');
  const breach = violatesRules(result.data.note);
  if (breach) throw new AnalysisUnavailable(`The India note wrote about pricing ("${breach}"), so it was discarded.`);
  return { ...result.data, model };
}

// Exposed so stored notes can be re-checked when the rules tighten. A note written under
// looser rules should not survive them.
export function auditNote(text: string): string | null {
  return violatesRules(text);
}
