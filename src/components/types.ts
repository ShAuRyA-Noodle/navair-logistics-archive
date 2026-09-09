export type Role = 'owner' | 'staff' | 'customer';
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: string[];
  active: boolean;
  isDemo: boolean;
};

export type Session = {
  user: Actor | null;
  demoMode: boolean;
  googleConfigured: boolean;
  mailMode: 'preview' | 'resend';
};

export type Enquiry = {
  id: string;
  reference: string;
  name: string;
  email?: string;
  phone?: string;
  origin: string;
  destination: string;
  mode: ShipmentMode;
  description?: string;
  status: 'pending' | 'accepted' | 'declined';
  isDemo: boolean;
  createdAt: string;
  acceptedAt: string | null;
  assignedTo: string | null;
  version: number;
};

export type ShipmentMode = 'air' | 'sea' | 'road' | 'courier' | 'other' | 'unsure';
export type RoutePriceSeries = { unit: string; currency: string };
export type Route = { id: string; origin: string; destination: string; mode: ShipmentMode; unit: string; priceSeries?: RoutePriceSeries[] };

export type Shipment = {
  id: string;
  routeId: string;
  status: string;
  promisedAt: string;
  estimatedAt: string | null;
  actualAt: string | null;
  sellingPrice?: number;
  currency?: string;
  unit?: string;
  quantity?: number;
  version: number;
  createdAt?: string;
  transitDays?: number | null;
  crossBorder?: boolean | null;
  mode?: string;
};

// The lifecycle module is the single definition of a stage; imported and re-exported here
// so client components can keep taking their types from one place.
import type { TrackedStage } from '@/lib/lifecycle';
export type { TrackedStage };

export type JourneyEvent = { id: string; status: string; description: string; occurredAt: string };
export type Journey = { enquiry: Enquiry; shipment: Shipment; events: JourneyEvent[]; stages: TrackedStage[] };
export type Forecast = {
  status: 'available' | 'insufficient_data';
  isDemo: boolean;
  label: string;
  reason: string | null;
  currency: string;
  unit: string;
  confidence: 80 | 95;
  weeks: number;
  history: Array<{ date: string; price: number }>;
  points: Array<{ week: number; date: string; estimate: number; lower: number; upper: number }>;
  referencePrice: number | null;
  changePercent: number | null;
  metrics: { mae: number | null; coverage: number | null; backtestCount: number };
  dataThrough: string | null;
};
export type Radar = {
  status: 'clear' | 'watch' | 'elevated' | 'insufficient_data';
  isDemo: boolean;
  message: string;
  sampleCount: number;
  delayedCount: number;
  earlyCount: number;
  unresolvedCount: number;
  typicalDelayDays: number | null;
  dataThrough: string | null;
  issues: string[];
};
export type Commitment = { id: string; enquiryId: string; assignedTo: string; title: string; dueAt: string; completedAt: string | null; reference: string };
export type MailMessage = { id: string; recipient: string; subject: string; body: string; kind: string; status: string; attempts: number; lastError: string | null; createdAt: string };
export type Pagination = { page: number; pageSize: number; hasMore: boolean };
export type Finance = { buyingCost: number; sellingPrice: number; margin: number; currency: string; unit: string; quantity: number };

export type ServiceCoverage = 'supported' | 'on_request' | 'not_supported' | 'unknown';
export type LaneMeta = { id: string; origin: string; destination: string; mode: string; unit: string; serviceCoverage: ServiceCoverage; distanceKm: number | null; transitDays: number | null; crossBorder: boolean | null };
export type ItineraryLeg = { routeId: string; origin: string; destination: string; mode: string; unit: string; serviceCoverage: ServiceCoverage; transitDays: number | null; distanceKm: number | null; crossBorder: boolean | null };
export type Itinerary = { legs: ItineraryLeg[]; transitDays: number | null; handoverDays: number; totalDays: number | null; needsDeskCheck: boolean; summary: string };
export type RoutePlan = {
  origin: string | null;
  destination: string | null;
  direct: ItineraryLeg[];
  connecting: Itinerary[];
  outcome: 'direct' | 'connecting' | 'same_city' | 'unknown_origin' | 'unknown_destination' | 'unknown_both' | 'no_service';
  cities: { origins: string[]; destinations: string[] };
};
export type LaneForecast = {
  status: 'available' | 'insufficient_data';
  reason: string | null;
  model: 'seasonal' | 'trend' | null;
  currency: string;
  unit: string;
  confidence: 80 | 95;
  weeks: number;
  history: Array<{ date: string; price: number }>;
  points: Array<{ week: number; date: string; estimate: number; lower: number; upper: number }>;
  referencePrice: number | null;
  changePercent: number | null;
  seasonalNote: string | null;
  metrics: { chosenMae: number | null; trendMae: number | null; seasonalMae: number | null; coverage: number | null; backtestCount: number; historyWeeks: number };
  dataThrough: string | null;
};
export type LaneReliability = {
  status: 'clear' | 'watch' | 'elevated' | 'insufficient_data';
  headline: string;
  detail: string;
  recent: { days: number; deliveries: number; late: number; onTime: number; typicalDelayDays: number | null };
  baseline: { days: number; deliveries: number; late: number; lateRate: number | null };
  worseThanUsual: boolean;
  issues: string[];
  recentDays: Array<{ date: string; deliveries: number; late: number; delayDays: number | null }>;
  dataThrough: string | null;
};
export type LaneAnalysis = {
  lane: LaneMeta;
  series: Array<{ unit: string; currency: string; weeks: number }>;
  selected: { unit: string; currency: string; weeks: number } | null;
  forecast: LaneForecast | null;
  reliability: LaneReliability;
};
