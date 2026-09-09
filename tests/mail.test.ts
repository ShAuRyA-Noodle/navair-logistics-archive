import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: '.env.local', quiet: true });
process.env.MAIL_MODE = 'preview';
delete process.env.MAIL_TEST_RECIPIENT;

import { handleMailWebhook, listMail, processOutbox } from '../src/lib/mail';
import { pool, withActor } from '../src/lib/db';

const admin = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const owner = randomUUID();
const customer = randomUUID();
const tag = randomUUID().slice(0, 8);

async function addMail(status = 'pending', options: { providerId?: string; firstAttemptAt?: string; recipient?: string } = {}) {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO email_outbox(id,kind,recipient,subject,body,reply_to,idempotency_key,status,provider_id,first_attempt_at,available_at)
     VALUES($1,'staff',$2,'Test mail','Body','reply@example.test',$3,$4,$5,$6,now()-interval '1 minute')`,
    [id, options.recipient ?? `recipient-${tag}@example.test`, `test-mail/${id}`, status, options.providerId ?? null, options.firstAttemptAt ?? null],
  );
  return id;
}

function signedWebhook(payload: string, secret: string, id = `msg_${randomUUID()}`) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64');
  return { id, timestamp, signature: `v1,${signature}` };
}

beforeAll(async () => {
  process.env.WORKER_ACTOR_ID = owner;
  await admin.query(
    `INSERT INTO app_users(id,name,role,email,is_demo) VALUES
     ($1,'Mail Owner','owner',$2,true),($3,'Mail Customer','customer',$4,true)`,
    [owner, `owner-${tag}@example.test`, customer, `customer-${tag}@example.test`],
  );
});

beforeEach(async () => {
  await admin.query("UPDATE email_outbox SET status='preview',locked_at=NULL WHERE idempotency_key LIKE 'test-mail/%' AND status IN ('pending','processing')");
});

afterAll(async () => {
  await admin.end();
  await pool.end();
});

describe('durable mail outbox', () => {
  it('shows only the newest fifty mail jobs to a mail administrator', async () => {
    const id = await addMail();
    await expect(listMail(customer)).rejects.toMatchObject({ status: 403 });
    const jobs = await listMail(owner);
    expect(jobs.find((job) => job.id === id)).toMatchObject({
      recipient: `recipient-${tag}@example.test`, subject: 'Test mail', body: 'Body', kind: 'staff', status: 'pending', attempts: 0,
    });
    await admin.query("UPDATE email_outbox SET status='preview' WHERE id=$1", [id]);
  });

  it('claims a pending message once and finishes it as a terminal preview by default', async () => {
    const id = await addMail();
    const result = await processOutbox(owner);
    expect(result).toMatchObject({ processed: 1, preview: 1, sent: 0, failed: 0 });
    const job = await admin.query('SELECT status,attempts,first_attempt_at,locked_at FROM email_outbox WHERE id=$1', [id]);
    expect(job.rows[0]).toMatchObject({ status: 'preview', attempts: 1 });
    expect(job.rows[0].first_attempt_at).not.toBeNull();
    expect(job.rows[0].locked_at).toBeNull();
  });

  it('recovers a stale lease without allowing two workers to send the same job', async () => {
    const id = await addMail('processing');
    await admin.query("UPDATE email_outbox SET locked_at=now()-interval '6 minutes' WHERE id=$1", [id]);
    const [one, two] = await Promise.all([processOutbox(owner), processOutbox(owner)]);
    expect(one.processed + two.processed).toBeGreaterThanOrEqual(1);
    const job = await admin.query('SELECT status,attempts FROM email_outbox WHERE id=$1', [id]);
    expect(job.rows[0]).toMatchObject({ status: 'preview', attempts: 1 });
  });

  it('records a terminal configuration failure instead of defaulting to a live sender', async () => {
    const id = await addMail();
    process.env.MAIL_MODE = 'resend';
    delete process.env.RESEND_API_KEY;
    const result = await processOutbox(owner);
    process.env.MAIL_MODE = 'preview';
    expect(result).toMatchObject({ processed: 1, preview: 0, sent: 0, failed: 1 });
    const job = await admin.query('SELECT status,last_error FROM email_outbox WHERE id=$1', [id]);
    expect(job.rows[0]).toMatchObject({ status: 'failed' });
    expect(job.rows[0].last_error).toMatch(/RESEND_API_KEY/);
  });

  it('uses the saved idempotency key and delays a transient provider failure', async () => {
    const id = await addMail();
    process.env.MAIL_MODE = 'resend';
    process.env.RESEND_API_KEY = 're_test_transport';
    process.env.BUSINESS_EMAIL = 'owner@gmail.com';
    process.env.MAIL_FROM = 'Navair <operations@mail.navair-logistics.co>';
    let receivedKey = '';
    const result = await processOutbox(owner, async (_config, job) => {
      receivedKey = job.idempotency_key;
      throw Object.assign(new Error('concurrent_idempotent_requests'), { statusCode: 409, code: 'concurrent_idempotent_requests' });
    });
    process.env.MAIL_MODE = 'preview';
    expect(receivedKey).toBe(`test-mail/${id}`);
    expect(result).toMatchObject({ processed: 1, preview: 0, sent: 0, failed: 0 });
    const job = await admin.query('SELECT status,attempts,last_error,available_at FROM email_outbox WHERE id=$1', [id]);
    expect(job.rows[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect(job.rows[0].last_error).toMatch(/concurrent_idempotent_requests/);
    expect(new Date(job.rows[0].available_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('accepts a Gmail business recipient when MAIL_FROM uses a valid sending domain', async () => {
    const id = await addMail();
    process.env.MAIL_MODE = 'resend';
    process.env.RESEND_API_KEY = 're_test_transport';
    process.env.BUSINESS_EMAIL = 'owner@gmail.com';
    process.env.MAIL_FROM = 'Navair <operations@mail.navair-logistics.co>';
    let from = '';
    const result = await processOutbox(owner, async (config) => {
      from = config.from;
      return { id: `provider-${id}` };
    });
    process.env.MAIL_MODE = 'preview';
    expect(result).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(from).toBe('Navair <operations@mail.navair-logistics.co>');
  });

  it('blocks a recipient outside MAIL_TEST_RECIPIENT before invoking the live transport', async () => {
    const id = await addMail();
    process.env.MAIL_MODE = 'resend';
    process.env.RESEND_API_KEY = 're_test_transport';
    process.env.BUSINESS_EMAIL = 'owner@gmail.com';
    process.env.MAIL_FROM = 'Navair <operations@mail.navair-logistics.co>';
    process.env.MAIL_TEST_RECIPIENT = 'shauryapunj404@gmail.com';
    let called = false;
    const result = await processOutbox(owner, async () => {
      called = true;
      return { id: `provider-${id}` };
    });
    delete process.env.MAIL_TEST_RECIPIENT;
    process.env.MAIL_MODE = 'preview';
    expect(called).toBe(false);
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    expect((await admin.query('SELECT status,last_error FROM email_outbox WHERE id=$1', [id])).rows[0])
      .toMatchObject({ status: 'failed', last_error: 'Recipient outside active test allowlist.' });
  });

  it('allows the configured MAIL_TEST_RECIPIENT to reach the live transport', async () => {
    const recipient = 'shauryapunj404@gmail.com';
    const id = await addMail('pending', { recipient });
    process.env.MAIL_MODE = 'resend';
    process.env.RESEND_API_KEY = 're_test_transport';
    process.env.BUSINESS_EMAIL = recipient;
    process.env.MAIL_FROM = 'Navair <operations@mail.navair-logistics.co>';
    process.env.MAIL_TEST_RECIPIENT = recipient;
    let called = false;
    const result = await processOutbox(owner, async (_config, job) => {
      called = job.recipient === recipient;
      return { id: `provider-${id}` };
    });
    delete process.env.MAIL_TEST_RECIPIENT;
    process.env.MAIL_MODE = 'preview';
    expect(called).toBe(true);
    expect(result).toMatchObject({ processed: 1, sent: 1, failed: 0 });
  });

  it('fails closed when MAIL_TEST_RECIPIENT is blank', async () => {
    const id = await addMail();
    process.env.MAIL_MODE = 'resend';
    process.env.RESEND_API_KEY = 're_test_transport';
    process.env.BUSINESS_EMAIL = 'owner@gmail.com';
    process.env.MAIL_FROM = 'Navair <operations@mail.navair-logistics.co>';
    process.env.MAIL_TEST_RECIPIENT = '   ';
    let called = false;
    const result = await processOutbox(owner, async () => {
      called = true;
      return { id: `provider-${id}` };
    });
    delete process.env.MAIL_TEST_RECIPIENT;
    process.env.MAIL_MODE = 'preview';
    expect(called).toBe(false);
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    expect((await admin.query('SELECT last_error FROM email_outbox WHERE id=$1', [id])).rows[0].last_error)
      .toBe('MAIL_TEST_RECIPIENT must be a valid email address.');
  });

  it('does not invoke a live transport after the idempotency window has expired', async () => {
    const id = await addMail('pending', { firstAttemptAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() });
    await admin.query('UPDATE email_outbox SET attempts=2 WHERE id=$1', [id]);
    process.env.MAIL_MODE = 'resend';
    process.env.RESEND_API_KEY = 're_test_transport';
    process.env.BUSINESS_EMAIL = 'owner@gmail.com';
    process.env.MAIL_FROM = 'Navair <operations@mail.navair-logistics.co>';
    let called = false;
    const result = await processOutbox(owner, async () => {
      called = true;
      return { id: 'should-not-send' };
    });
    process.env.MAIL_MODE = 'preview';
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    expect(called).toBe(false);
    expect((await admin.query('SELECT status FROM email_outbox WHERE id=$1', [id])).rows[0].status).toBe('uncertain');
  });

  it('fences an expired worker lease so it cannot finish a reclaimed job', async () => {
    const id = await addMail();
    const first = await withActor(owner, async (db) => (await db.query('SELECT * FROM public.claim_email_outbox(1)')).rows[0]);
    await admin.query("UPDATE email_outbox SET locked_at=now()-interval '6 minutes' WHERE id=$1", [id]);
    const second = await withActor(owner, async (db) => (await db.query('SELECT * FROM public.claim_email_outbox(1)')).rows[0]);
    expect(second.lease_id).not.toBe(first.lease_id);
    const oldFinish = await withActor(owner, async (db) => (await db.query(
      "SELECT public.finish_email_outbox($1,$2,'preview',NULL,NULL,NULL) AS changed", [id, first.lease_id],
    )).rows[0]);
    expect(oldFinish.changed).toBe(false);
    const current = await admin.query('SELECT status,lease_id FROM email_outbox WHERE id=$1', [id]);
    expect(current.rows[0]).toMatchObject({ status: 'processing', lease_id: second.lease_id });
  });

  it('reconciles a verified delivery webhook that arrives before the provider id is persisted', async () => {
    const id = await addMail();
    const providerId = `provider-before-finish-${randomUUID()}`;
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    process.env.RESEND_WEBHOOK_SECRET = secret;
    process.env.RESEND_API_KEY = 're_test_transport';
    const delivered = JSON.stringify({ type: 'email.delivered', created_at: '2026-09-08T00:00:00.000Z', data: { email_id: providerId } });
    await handleMailWebhook(delivered, signedWebhook(delivered, secret));
    process.env.MAIL_MODE = 'resend';
    process.env.BUSINESS_EMAIL = 'owner@gmail.com';
    process.env.MAIL_FROM = 'Navair <operations@mail.navair-logistics.co>';
    await processOutbox(owner, async () => ({ id: providerId }));
    process.env.MAIL_MODE = 'preview';
    expect((await admin.query('SELECT status,provider_id FROM email_outbox WHERE id=$1', [id])).rows[0]).toMatchObject({ status: 'delivered', provider_id: providerId });
  });

  it('verifies a raw Svix event, deduplicates it, and never regresses bounced mail to delivered', async () => {
    const providerId = `provider-${randomUUID()}`;
    const id = await addMail('sent', { providerId });
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    process.env.RESEND_WEBHOOK_SECRET = secret;
    process.env.RESEND_API_KEY = 're_test_mail_webhook_verification';
    const bounced = JSON.stringify({ type: 'email.bounced', created_at: '2026-09-08T00:00:00.000Z', data: { email_id: providerId } });
    const bounceHeaders = signedWebhook(bounced, secret, `msg_${randomUUID()}`);
    await expect(handleMailWebhook(bounced, bounceHeaders)).resolves.toEqual({ ok: true, duplicate: false });
    await expect(handleMailWebhook(bounced, bounceHeaders)).resolves.toEqual({ ok: true, duplicate: true });
    const delivered = JSON.stringify({ type: 'email.delivered', created_at: '2026-09-08T00:01:00.000Z', data: { email_id: providerId } });
    await handleMailWebhook(delivered, signedWebhook(delivered, secret));
    const job = await admin.query('SELECT status FROM email_outbox WHERE id=$1', [id]);
    expect(job.rows[0].status).toBe('bounced');
  });

  it('rejects an invalid webhook signature before performing a database transition', async () => {
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${randomBytes(32).toString('base64')}`;
    process.env.RESEND_API_KEY = 're_test_mail_webhook_verification';
    const payload = JSON.stringify({ type: 'email.sent', created_at: '2026-09-08T00:00:00.000Z', data: { email_id: `provider-${randomUUID()}` } });
    await expect(handleMailWebhook(payload, { id: `msg_${randomUUID()}`, timestamp: Math.floor(Date.now() / 1000).toString(), signature: 'v1,invalid' }))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_WEBHOOK_SIGNATURE' });
  });
});
