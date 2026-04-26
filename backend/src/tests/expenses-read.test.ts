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

function insertExpense(id: string, opts: {
  amount_paise: number;
  category: string;
  description: string;
  date: string;
  created_at: string;
}) {
  db.prepare(
    `INSERT INTO expenses (id, amount_paise, category, description, date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, opts.amount_paise, opts.category, opts.description, opts.date, opts.created_at);
}

describe('GET /expenses', () => {
  it('empty DB returns []', async () => {
    const res = await app.inject({ method: 'GET', url: '/expenses' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns three expenses newest first', async () => {
    insertExpense('a', { amount_paise: 100, category: 'Food', description: 'A', date: '2024-01-10', created_at: '2024-01-10T08:00:00.000Z' });
    insertExpense('b', { amount_paise: 200, category: 'Food', description: 'B', date: '2024-01-12', created_at: '2024-01-12T08:00:00.000Z' });
    insertExpense('c', { amount_paise: 300, category: 'Food', description: 'C', date: '2024-01-11', created_at: '2024-01-11T08:00:00.000Z' });

    const res = await app.inject({ method: 'GET', url: '/expenses' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { id: string }[];
    expect(rows.map(r => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('same-date tiebreaker uses created_at DESC', async () => {
    insertExpense('first', { amount_paise: 100, category: 'Food', description: 'First', date: '2024-01-15', created_at: '2024-01-15T08:00:00.000Z' });
    insertExpense('second', { amount_paise: 200, category: 'Food', description: 'Second', date: '2024-01-15', created_at: '2024-01-15T09:00:00.000Z' });

    const res = await app.inject({ method: 'GET', url: '/expenses' });
    const rows = res.json() as { id: string }[];
    // second was created later, so it comes first
    expect(rows.map(r => r.id)).toEqual(['second', 'first']);
  });

  it('filters by category', async () => {
    insertExpense('a', { amount_paise: 100, category: 'Food', description: 'A', date: '2024-01-10', created_at: '2024-01-10T08:00:00.000Z' });
    insertExpense('b', { amount_paise: 200, category: 'Travel', description: 'B', date: '2024-01-11', created_at: '2024-01-11T08:00:00.000Z' });
    insertExpense('c', { amount_paise: 300, category: 'Food', description: 'C', date: '2024-01-12', created_at: '2024-01-12T08:00:00.000Z' });

    const res = await app.inject({ method: 'GET', url: '/expenses?category=Food' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { id: string; category: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.category === 'Food')).toBe(true);
  });

  it('filter by non-existent category returns []', async () => {
    insertExpense('a', { amount_paise: 100, category: 'Food', description: 'A', date: '2024-01-10', created_at: '2024-01-10T08:00:00.000Z' });

    const res = await app.inject({ method: 'GET', url: '/expenses?category=Nonexistent' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('category filter is case-sensitive', async () => {
    insertExpense('a', { amount_paise: 100, category: 'Food', description: 'A', date: '2024-01-10', created_at: '2024-01-10T08:00:00.000Z' });

    const res = await app.inject({ method: 'GET', url: '/expenses?category=food' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('invalid sort value returns 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/expenses?sort=date_asc' });
    expect(res.statusCode).toBe(400);
  });

  it('amount_paise is a number and an integer in the response', async () => {
    insertExpense('a', { amount_paise: 32450, category: 'Food', description: 'A', date: '2024-01-10', created_at: '2024-01-10T08:00:00.000Z' });

    const res = await app.inject({ method: 'GET', url: '/expenses' });
    const rows = res.json() as { amount_paise: unknown }[];
    expect(typeof rows[0].amount_paise).toBe('number');
    expect(Number.isInteger(rows[0].amount_paise)).toBe(true);
    expect(rows[0].amount_paise).toBe(32450);
  });
});
