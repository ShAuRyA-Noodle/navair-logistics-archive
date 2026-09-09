import { Resend } from 'resend';
import { withActor } from './db';
import { AppError } from './errors';
import { requirePermission } from './operations';

type MailStatus = 'pending' | 'processing' | 'preview' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'complained' | 'uncertain';
type MailJob = {
  id: string; recipient: string; subject: string; body: string; kind: string; status: MailStatus;
  attempts: number; first_attempt_at: Date | string | null; idempotency_key: string; reply_to: string; lease_id: string;
};
type MailMode = 'preview' | 'resend';
type MailConfig = { mode: MailMode; apiKey?: string; from?: string };
export type MailTransport = (config: { apiKey: string; from: string }, job: Pick<MailJob, 'recipient' | 'subject' | 'body' | 'reply_to' | 'idempotency_key'>) => Promise<{ id: string }>;

const MAX_ATTEMPTS = 5;
const RESEND_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const TRANSPORT_TIMEOUT_MS = 4 * 60 * 1000;
const PUBLIC_SENDER_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com']);
class MailConfigurationError extends Error {}
class MailTransportTimeoutError extends Error {}
class TestRecipientRestrictionError extends Error {}

function environment(): MailConfig {
  const mode = process.env.MAIL_MODE ?? 'preview';
  if (mode === 'preview') return { mode };
  if (mode !== 'resend') throw new MailConfigurationError('MAIL_MODE must be preview or resend.');
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const business = process.env.BUSINESS_EMAIL;
  if (!apiKey) throw new MailConfigurationError('RESEND_API_KEY is required when MAIL_MODE=resend.');
  if (!from) throw new MailConfigurationError('MAIL_FROM is required when MAIL_MODE=resend.');
  if (!business) throw new MailConfigurationError('BUSINESS_EMAIL is required when MAIL_MODE=resend.');
  const fromDomain = emailDomain(from);
  if (!fromDomain || isPublicOrPlaceholderDomain(fromDomain)) {
    throw new MailConfigurationError('MAIL_FROM must use a non-public, non-placeholder sending domain.');
  }
  if (!emailDomain(business)) throw new MailConfigurationError('BUSINESS_EMAIL must be a valid email address.');
  return { mode, apiKey, from };
}

function emailDomain(value: string) {
  const address = value.match(/<([^<>]+)>/)?.[1] ?? value;
  const match = /^\s*[^\s@<>]+@([^\s@<>]+)\s*$/i.exec(address);
  return match?.[1]?.toLowerCase();
}

function normalizedEmail(value: string) {
  return /^\s*[^\s@<>]+@[^\s@<>]+\s*$/i.test(value) ? value.trim().toLowerCase() : undefined;
}

function enforceTestRecipient(recipient: string) {
  const configured = process.env.MAIL_TEST_RECIPIENT;
  if (configured === undefined) return;
  const allowed = normalizedEmail(configured);
  if (!allowed) throw new MailConfigurationError('MAIL_TEST_RECIPIENT must be a valid email address.');
  if (normalizedEmail(recipient) !== allowed) throw new TestRecipientRestrictionError('Recipient outside active test allowlist.');
}

function isPublicOrPlaceholderDomain(domain: string) {
  return PUBLIC_SENDER_DOMAINS.has(domain) || domain === 'example.com' || /\.(example|test|invalid|localhost)$/.test(domain);
}

function message(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}

function responseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } };
  for (const value of [candidate.statusCode, candidate.status, candidate.response?.status]) {
    if (typeof value === 'number') return value;
  }
  return undefined;
}

function canRetry(job: MailJob, error: unknown) {
  if (error instanceof MailConfigurationError || error instanceof TestRecipientRestrictionError) return false;
  const status = responseStatus(error);
  const transient = status === undefined || status === 429 || status >= 500 || (status === 409 && isConcurrentIdempotencyError(error));
  const firstAttempt = job.first_attempt_at ? new Date(job.first_attempt_at).getTime() : Date.now();
  return transient && job.attempts < MAX_ATTEMPTS && Date.now() - firstAttempt < RESEND_IDEMPOTENCY_WINDOW_MS;
}

function isConcurrentIdempotencyError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; type?: unknown; code?: unknown; message?: unknown };
  return [candidate.name, candidate.type, candidate.code, candidate.message]
    .some((value) => typeof value === 'string' && value.includes('concurrent_idempotent_requests'));
}

function retryAt(attempts: number) {
  const seconds = Math.min(15 * 60, 30 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function finish(actorId: string, job: MailJob, status: 'pending' | 'preview' | 'sent' | 'failed' | 'uncertain', options: { providerId?: string; error?: string; availableAt?: string } = {}) {
  return withActor(actorId, async (db) => {
    const result = await db.query(
      'SELECT public.finish_email_outbox($1,$2,$3,$4,$5,$6) AS changed',
      [job.id, job.lease_id, status, options.providerId ?? null, options.error ?? null, options.availableAt ?? null],
    );
    if (!result.rows[0]?.changed) throw new Error(`Mail job ${job.id} lease was lost before completion.`);
  });
}

async function withTransportTimeout<T>(operation: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new MailTransportTimeoutError('Mail transport timed out before its lease expired.')), TRANSPORT_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const resendTransport: MailTransport = async (config, job) => {
  const response = await new Resend(config.apiKey).emails.send({
    from: config.from, to: [job.recipient], subject: job.subject, text: job.body, replyTo: job.reply_to,
  }, { idempotencyKey: job.idempotency_key });
  if (response.error || !response.data?.id) throw response.error ?? new Error('Resend returned no provider email id.');
  return { id: response.data.id };
};

export async function listMail(actorId: string) {
  return withActor(actorId, async (db) => {
    await requirePermission(db, 'mail.manage');
    return (await db.query(
      `SELECT id,recipient,subject,body,kind,status,attempts,last_error AS "lastError",created_at AS "createdAt"
       FROM email_outbox ORDER BY created_at DESC LIMIT 50`,
    )).rows as Array<{ id: string; recipient: string; subject: string; body: string; kind: string; status: MailStatus; attempts: number; lastError: string | null; createdAt: string }>;
  });
}

export async function processOutbox(actorId: string, send: MailTransport = resendTransport): Promise<{ processed: number; preview: number; sent: number; failed: number }> {
  const jobs = await withActor(actorId, async (db) => {
    await requirePermission(db, 'mail.manage');
    return (await db.query('SELECT * FROM public.claim_email_outbox($1)', [1])).rows as MailJob[];
  });
  const result = { processed: jobs.length, preview: 0, sent: 0, failed: 0 };
  for (const job of jobs) {
    try {
      const config = environment();
      if (config.mode === 'preview') {
        await finish(actorId, job, 'preview');
        result.preview += 1;
        continue;
      }
      const firstAttempt = job.first_attempt_at ? new Date(job.first_attempt_at).getTime() : Date.now();
      if (job.attempts > 1 && Date.now() - firstAttempt >= RESEND_IDEMPOTENCY_WINDOW_MS) {
        await finish(actorId, job, 'uncertain', { error: 'Resend idempotency window expired before a safe retry.' });
        result.failed += 1;
        continue;
      }
      enforceTestRecipient(job.recipient);
      const response = await withTransportTimeout(send({ apiKey: config.apiKey!, from: config.from! }, job));
      await finish(actorId, job, 'sent', { providerId: response.id });
      result.sent += 1;
    } catch (error) {
      const errorMessage = message(error);
      if (canRetry(job, error)) {
        await finish(actorId, job, 'pending', { error: errorMessage, availableAt: retryAt(job.attempts) });
      } else {
        const firstAttempt = job.first_attempt_at ? new Date(job.first_attempt_at).getTime() : Date.now();
        const uncertain = responseStatus(error) === undefined && Date.now() - firstAttempt >= RESEND_IDEMPOTENCY_WINDOW_MS;
        await finish(actorId, job, uncertain ? 'uncertain' : 'failed', { error: errorMessage });
        result.failed += 1;
      }
    }
  }
  return result;
}

export async function handleMailWebhook(rawBody: string, headers: { id: string; timestamp: string; signature: string }) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) throw new AppError(500, 'MAIL_WEBHOOK_CONFIG', 'RESEND_WEBHOOK_SECRET is not configured.');
  let verified: unknown;
  try {
    verified = new Resend(process.env.RESEND_API_KEY ?? '').webhooks.verify({ payload: rawBody, headers, webhookSecret: secret });
  } catch {
    throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook signature could not be verified.');
  }
  if (!verified || typeof verified !== 'object') throw new AppError(400, 'INVALID_WEBHOOK', 'Webhook payload is invalid.');
  const event = verified as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } };
  const providerId = event.data?.email_id;
  if (typeof event.type !== 'string' || typeof event.created_at !== 'string' || typeof providerId !== 'string' || Number.isNaN(Date.parse(event.created_at))) {
    throw new AppError(400, 'INVALID_WEBHOOK', 'Webhook payload is invalid.');
  }
  const actorId = process.env.WORKER_ACTOR_ID;
  if (!actorId) throw new AppError(500, 'MAIL_WORKER_CONFIG', 'WORKER_ACTOR_ID is required for mail webhooks.');
  const duplicate = await withActor(actorId, async (db) => {
    const row = await db.query('SELECT public.record_email_webhook($1,$2,$3,$4) AS inserted', [headers.id, providerId, event.type, event.created_at]);
    return !row.rows[0]?.inserted;
  });
  return { ok: true, duplicate };
}
