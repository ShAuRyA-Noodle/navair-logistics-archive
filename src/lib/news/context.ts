// Hard numbers to anchor the analysis.
//
// A model told only "Hormuz transits are down 48%" has to guess whether that matters to an
// Indian exporter. Given "India shipped $33bn to the UAE last year" it does not have to
// guess. These three official sources lag by a year or more, so they never describe today -
// they describe scale, which is exactly what an event's significance depends on.

const TIMEOUT_MS = 15_000;

// Comtrade reporter/partner codes (M49). India reports; the rest are our corridor ends.
const INDIA = 699;
const CORRIDOR_PARTNERS: Record<string, { code: number; name: string }> = {
  gulf: { code: 784, name: 'United Arab Emirates' },
  europe: { code: 528, name: 'Netherlands' },
  sea_asia: { code: 702, name: 'Singapore' },
  east_asia: { code: 156, name: 'China' },
  americas: { code: 842, name: 'United States' },
};

export type CorridorContext = {
  corridor: string;
  partner: string | null;
  annualExportUsd: number | null;
  exportYear: number | null;
  partnerTariffPercent: number | null;
  tariffYear: number | null;
  crudePriceUsd: number | null;
  crudePriceDate: string | null;
};

const cache = new Map<string, { value: CorridorContext; at: number }>();
const CACHE_MS = 12 * 60 * 60 * 1000;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// India's exports to the corridor's main destination, latest year Comtrade has.
async function annualExports(partner: number): Promise<{ usd: number; year: number } | null> {
  const key = process.env.COMTRADE_API_KEY;
  if (!key) return null;
  const year = new Date().getUTCFullYear() - 2;
  try {
    const payload = await getJson(
      `https://comtradeapi.un.org/data/v1/get/C/A/HS?reporterCode=${INDIA}&period=${year}&partnerCode=${partner}&flowCode=X&cmdCode=TOTAL`,
      { 'Ocp-Apim-Subscription-Key': key },
    ) as { data?: Array<{ primaryValue?: number; period?: string | number }> };
    const row = payload.data?.find((entry) => typeof entry.primaryValue === 'number');
    return row?.primaryValue ? { usd: Math.round(row.primaryValue), year: Number(row.period ?? year) } : null;
  } catch {
    return null;
  }
}

// The destination's own average applied tariff - what Indian goods meet on arrival.
const WTO_REPORTERS: Record<number, string> = { 784: '784', 528: '528', 702: '702', 156: '156', 842: '842' };

async function appliedTariff(partner: number): Promise<{ percent: number; year: number } | null> {
  const key = process.env.WTO_API_KEY;
  const reporter = WTO_REPORTERS[partner];
  if (!key || !reporter) return null;
  try {
    const payload = await getJson(
      `https://api.wto.org/timeseries/v1/data?i=TP_A_0010&r=${reporter}&max=3&fmt=json&mode=full&lang=1&meta=false`,
      { 'Ocp-Apim-Subscription-Key': key },
    ) as { Dataset?: Array<{ Value?: number; Year?: number }> };
    const rows = (payload.Dataset ?? []).filter((row) => typeof row.Value === 'number');
    const latest = rows.sort((left, right) => (right.Year ?? 0) - (left.Year ?? 0))[0];
    return latest?.Value !== undefined ? { percent: latest.Value, year: latest.Year ?? 0 } : null;
  } catch {
    return null;
  }
}

// Crude price moves bunker and jet fuel, which is the mechanism by which a Gulf disruption
// reaches a freight bill at all.
async function crudePrice(): Promise<{ usd: number; date: string } | null> {
  const key = process.env.EIA_API_KEY;
  if (!key) return null;
  try {
    const payload = await getJson(
      'https://api.eia.gov/v2/petroleum/pri/spt/data/?frequency=daily&data[0]=value'
      + '&facets[series][]=RBRTE&sort[0][column]=period&sort[0][direction]=desc&length=1'
      + `&api_key=${encodeURIComponent(key)}`,
    ) as { response?: { data?: Array<{ value?: number | string; period?: string }> } };
    const row = payload.response?.data?.[0];
    const value = row?.value === undefined ? null : Number(row.value);
    return value && Number.isFinite(value) ? { usd: value, date: String(row?.period ?? '') } : null;
  } catch {
    return null;
  }
}

export async function corridorContext(corridor: string): Promise<CorridorContext> {
  const cached = cache.get(corridor);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const region = corridor.split('-')[0];
  const partner = CORRIDOR_PARTNERS[region] ?? null;
  const [exports, tariff, crude] = await Promise.all([
    partner ? annualExports(partner.code) : Promise.resolve(null),
    partner ? appliedTariff(partner.code) : Promise.resolve(null),
    crudePrice(),
  ]);
  const value: CorridorContext = {
    corridor,
    partner: partner?.name ?? null,
    annualExportUsd: exports?.usd ?? null,
    exportYear: exports?.year ?? null,
    partnerTariffPercent: tariff?.percent ?? null,
    tariffYear: tariff?.year ?? null,
    crudePriceUsd: crude?.usd ?? null,
    crudePriceDate: crude?.date ?? null,
  };
  cache.set(corridor, { value, at: Date.now() });
  return value;
}

export function describeContext(context: CorridorContext): string[] {
  const lines: string[] = [];
  if (context.annualExportUsd && context.partner) {
    lines.push(`India exported about US$${(context.annualExportUsd / 1e9).toFixed(1)} billion of goods to ${context.partner} in ${context.exportYear} (UN Comtrade).`);
  }
  if (context.partnerTariffPercent !== null && context.partner) {
    lines.push(`${context.partner} applied an average MFN tariff of ${context.partnerTariffPercent}% in ${context.tariffYear} (WTO).`);
  }
  if (context.crudePriceUsd) {
    lines.push(`Brent crude last settled at US$${context.crudePriceUsd} on ${context.crudePriceDate} (US EIA).`);
  }
  return lines;
}
