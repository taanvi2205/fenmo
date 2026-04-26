import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE expenses (
      id           TEXT PRIMARY KEY,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      category     TEXT NOT NULL,
      description  TEXT NOT NULL,
      date         TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE TABLE idempotency_keys (
      key        TEXT PRIMARY KEY,
      expense_id TEXT NOT NULL REFERENCES expenses(id),
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

const validBody = {
  amount: '324.50',
  category: 'Food',
  description: 'Lunch',
  date: '2024-01-15',
};

const IDEM_KEY = '550e8400-e29b-41d4-a716-446655440000';

let app: FastifyInstance;
let db: InstanceType<typeof Database>;

beforeEach(async () => {
  db = createTestDb();
  app = buildApp(db);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('POST /expenses — idempotency (sequential)', () => {
  it('first request returns 201, second returns 200 with identical body', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/expenses',
      headers: { 'idempotency-key': IDEM_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    expect(firstBody.amount_paise).toBe(32450);

    const second = await app.inject({
      method: 'POST',
      url: '/expenses',
      headers: { 'idempotency-key': IDEM_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(firstBody);

    const rowCount = (db.prepare('SELECT COUNT(*) as c FROM expenses').get() as { c: number }).c;
    expect(rowCount).toBe(1);
  });
});

describe('POST /expenses — idempotency (concurrent / race)', () => {
  it('concurrent identical requests produce exactly one row', async () => {
    const makeRequest = () =>
      app.inject({
        method: 'POST',
        url: '/expenses',
        headers: { 'idempotency-key': IDEM_KEY, 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      });

    const [r1, r2] = await Promise.all([makeRequest(), makeRequest()]);

    // Both must succeed (one 201, one 200 — or both 201 if they interleave in the same tick;
    // better-sqlite3 is synchronous so one always wins atomically)
    expect([200, 201]).toContain(r1.statusCode);
    expect([200, 201]).toContain(r2.statusCode);
    expect(r1.json()).toEqual(r2.json());

    const rowCount = (db.prepare('SELECT COUNT(*) as c FROM expenses').get() as { c: number }).c;
    expect(rowCount).toBe(1);
  });
});

describe('POST /expenses — same key, different body (Stripe-style)', () => {
  it('returns original stored response, ignores new body', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/expenses',
      headers: { 'idempotency-key': IDEM_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();

    const second = await app.inject({
      method: 'POST',
      url: '/expenses',
      headers: { 'idempotency-key': IDEM_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, amount: '999.99', description: 'Different' }),
    });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(firstBody);

    const rowCount = (db.prepare('SELECT COUNT(*) as c FROM expenses').get() as { c: number }).c;
    expect(rowCount).toBe(1);
  });
});

describe('POST /expenses — missing Idempotency-Key', () => {
  it('returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/expenses',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Idempotency-Key header required');
  });
});

describe('POST /expenses — invalid amounts', () => {
  it.each(['-1', '1.234', 'abc', '', '1e2'])('rejects amount "%s" with 400', async (amount) => {
    const res = await app.inject({
      method: 'POST',
      url: '/expenses',
      headers: { 'idempotency-key': IDEM_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, amount }),
    });
    expect(res.statusCode).toBe(400);

    const keyCount = (db.prepare('SELECT COUNT(*) as c FROM idempotency_keys').get() as { c: number }).c;
    expect(keyCount).toBe(0);

    const rowCount = (db.prepare('SELECT COUNT(*) as c FROM expenses').get() as { c: number }).c;
    expect(rowCount).toBe(0);
  });
});
