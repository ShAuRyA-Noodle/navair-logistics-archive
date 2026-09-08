import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import { processOutbox } from '../src/lib/mail';
import { pool } from '../src/lib/db';

const LOOP_DELAY_MS = 5_000;
const PUBLIC_SENDER_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com']);

async function actorId() {
  if (process.env.WORKER_ACTOR_ID) return process.env.WORKER_ACTOR_ID;
  if (process.env.LOCAL_DEMO_MODE !== 'true') throw new Error('WORKER_ACTOR_ID is required outside LOCAL_DEMO_MODE.');
  const result = await pool.query("SELECT id FROM public.demo_users() WHERE role='owner' LIMIT 1");
  if (!result.rows[0]?.id) throw new Error('No active demo owner is available for the local worker.');
  return result.rows[0].id as string;
}

function emailDomain(value: string) {
  const address = value.match(/<([^<>]+)>/)?.[1] ?? value;
  return /^\s*[^\s@<>]+@([^\s@<>]+)\s*$/i.exec(address)?.[1]?.toLowerCase();
}

function validateMailConfiguration() {
  const mode = process.env.MAIL_MODE ?? 'preview';
  if (mode === 'preview') return;
  if (mode !== 'resend') throw new Error('MAIL_MODE must be preview or resend.');
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM || !process.env.BUSINESS_EMAIL) throw new Error('RESEND_API_KEY, MAIL_FROM, and BUSINESS_EMAIL are required when MAIL_MODE=resend.');
  const senderDomain = emailDomain(process.env.MAIL_FROM);
  if (!senderDomain || PUBLIC_SENDER_DOMAINS.has(senderDomain) || senderDomain === 'example.com' || /\.(example|test|invalid|localhost)$/.test(senderDomain)) {
    throw new Error('MAIL_FROM must use a non-public, non-placeholder sending domain.');
  }
  if (!emailDomain(process.env.BUSINESS_EMAIL)) throw new Error('BUSINESS_EMAIL must be a valid email address.');
}

function logQueueError(error: unknown) {
  const status = error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
    ? ` status=${(error as { status: number }).status}` : '';
  console.error(`Mail queue processing failed${status}; retrying in ${LOOP_DELAY_MS / 1000}s.`);
}

let stopping = false;
const stop = () => { stopping = true; };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

validateMailConfiguration();
const workerActor = await actorId();
try {
  while (!stopping) {
    try {
      await processOutbox(workerActor);
    } catch (error) {
      if (!stopping) logQueueError(error);
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, LOOP_DELAY_MS));
  }
} finally {
  await pool.end();
}
