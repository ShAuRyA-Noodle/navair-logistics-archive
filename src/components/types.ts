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
export type Route = { id: string; origin: string; destination: string; mode: ShipmentMode; unit: string };

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
};

export type JourneyEvent = { id: string; status: string; description: string; occurredAt: string };
export type Journey = { enquiry: Enquiry; shipment: Shipment; events: JourneyEvent[] };
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
