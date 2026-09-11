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
const TIMEOUT_MS = 60_000;

export type AnalysisInput = {
  corridor: string;
  event: { title: string; summary: string; topics: string[]; chokepoints: string[]; importance: number };
  articles: Array<{ title: string; sourceKey: string; url: string | null; publishedAt: string; summary: string | null }>;
  measurements: Array<Record<string, unknown>>;
};

const schema = z.object({
  severity: z.enum(['none', 'watch', 'elevated', 'severe']),
  headline: z.string().trim().min(8).max(120),
  teaser: z.string().trim().min(20).max(240),
  body: z.string().trim().min(80).max(2400),
  actions: z.array(z.string().trim().min(8).max(240)).max(4).default([]),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type Analysis = z.infer<typeof schema> & { model: string; citations: string[] };

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
  'You advise Indian exporters and importers at a freight forwarder called Navair.',
  'Given a world event and one shipping corridor, explain what practically changes for cargo moving on that corridor.',
  '',
  'Absolute rules:',
  '1. Never state, estimate or imply a price, freight rate, percentage cost change, or market direction. Navair publishes its own statistically backtested price forecast and your text must never compete with it or contradict it.',
  '2. Never predict markets, stock moves or currency. You explain operational consequence only: availability of space, transit time, routing, paperwork, congestion, insurance and planning.',
  '3. Use only the reports and official figures supplied. If they do not support a claim, leave it out. Invent nothing - no vessel names, no dates, no numbers that were not given to you.',
  '4. If the supplied material genuinely does not affect this corridor, answer with severity "none" and say so plainly. That is a useful answer, not a failure.',
  '5. Write for somebody shipping for the first time. Short sentences, ordinary words, no jargon, no filler. Never write phrases like "in today\'s dynamic landscape" or "it is important to note".',
  '6. State your uncertainty in the body when the evidence is thin.',
  '',
  'Return only JSON matching this shape:',
  '{"severity":"none|watch|elevated|severe","headline":"under 15 words","teaser":"one sentence, under 30 words","body":"2 to 4 short paragraphs","actions":["concrete step",...max 4],"confidence":"low|medium|high"}',
].join('\n');

// Words that mean the model slipped into pricing or market talk despite the rules. Caught
// here rather than trusted, because the whole separation depends on it holding.
const FORBIDDEN = [
  /freight rate/i, /\bper\s?(kg|kilo|container|teu)\b/i, /\b(inr|usd|rs\.?|\$|₹)\s?\d/i,
  /\d+\s?%\s?(increase|rise|higher|drop|fall|cheaper|more expensive)/i,
  /price(s)? (will|should|could|may) (rise|fall|increase|drop|climb)/i,
  /\bwe (expect|forecast|predict) (prices|rates)/i,
];

function violatesRules(text: string): string | null {
  for (const pattern of FORBIDDEN) {
    const hit = pattern.exec(text);
    if (hit) return hit[0];
  }
  return null;
}

function buildPrompt(input: AnalysisInput, contextLines: string[]): string {
  const articles = input.articles.slice(0, 8).map((article, index) =>
    `[${index + 1}] ${article.title}${article.summary ? ` — ${article.summary.slice(0, 300)}` : ''} (${article.sourceKey}, ${article.publishedAt.slice(0, 10)})`);
  const measurements = input.measurements.map((measurement) => {
    const ratio = typeof measurement.changeRatio === 'number' ? `${Math.round(measurement.changeRatio * 100)}%` : 'unknown';
    return `${measurement.chokepoint ?? 'chokepoint'}: recorded transits ${ratio} against their own 90-day median (IMF PortWatch satellite sample; a sample, not a full count of ships).`;
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
    'Explain what this means for cargo on this corridor. Remember: no prices, no rates, no market predictions.',
  ].filter(Boolean).join('\n');
}

export async function analyseImpact(input: AnalysisInput): Promise<Analysis> {
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
        max_completion_tokens: 1200,
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

  const breach = violatesRules(`${result.data.headline} ${result.data.teaser} ${result.data.body} ${result.data.actions.join(' ')}`);
  if (breach) throw new AnalysisUnavailable(`The model wrote about pricing ("${breach}"), which this feature must never do, so the answer was discarded.`);

  return {
    ...result.data,
    model,
    citations: input.articles.slice(0, 8).map((article) => article.url).filter((url): url is string => Boolean(url)),
  };
}
