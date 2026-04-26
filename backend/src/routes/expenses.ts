import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { rupeesToPaise } from '../lib/money.js';
import type { Database } from 'better-sqlite3';

const CreateExpenseSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid rupee amount'),
  category: z.string().min(1).max(64),
  description: z.string().min(1).max(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

// Accepts any non-empty string up to 128 chars as idempotency key.
// UUID v4 is the expected format from the client, but we don't enforce
// the format server-side — the UNIQUE constraint is what matters for safety.
const IDEM_KEY_MAX = 128;

export default async function expensesWriteRoute(app: FastifyInstance, { db }: { db: Database }) {
  const createExpense = db.transaction((data: {
    amountPaise: number;
    category: string;
    description: string;
    date: string;
  }, idemKey: string) => {
    const existing = db.prepare(
      'SELECT expense_id FROM idempotency_keys WHERE key = ?'
    ).get(idemKey) as { expense_id: string } | undefined;

    if (existing) {
      const expense = db.prepare(
        'SELECT * FROM expenses WHERE id = ?'
      ).get(existing.expense_id);
      return { expense, created: false };
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO expenses (id, amount_paise, category, description, date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, data.amountPaise, data.category, data.description, data.date, createdAt);

    db.prepare(
      `INSERT INTO idempotency_keys (key, expense_id, created_at) VALUES (?, ?, ?)`
    ).run(idemKey, id, createdAt);

    return {
      expense: {
        id,
        amount_paise: data.amountPaise,
        category: data.category,
        description: data.description,
        date: data.date,
        created_at: createdAt,
      },
      created: true,
    };
  });

  app.post('/expenses', async (request, reply) => {
    const idemKey = request.headers['idempotency-key'];

    if (!idemKey || typeof idemKey !== 'string' || idemKey.length === 0 || idemKey.length > IDEM_KEY_MAX) {
      return reply.status(400).send({ error: 'Idempotency-Key header required' });
    }

    const parsed = CreateExpenseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const { amount, category, description, date } = parsed.data;

    let amountPaise: number;
    try {
      amountPaise = rupeesToPaise(amount);
    } catch {
      return reply.status(400).send({ error: 'Invalid amount' });
    }

    if (amountPaise <= 0) {
      return reply.status(400).send({ error: 'Amount must be greater than zero' });
    }

    const { expense, created } = createExpense({ amountPaise, category, description, date }, idemKey);

    return reply.status(created ? 201 : 200).send(expense);
  });
}
