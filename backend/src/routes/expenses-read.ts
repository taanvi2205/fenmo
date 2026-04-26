import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';

const QuerySchema = z.object({
  category: z.string().min(1).max(64).optional(),
  sort: z.enum(['date_desc']).optional(),
});

// Two statements so SQLite can use idx_expenses_category when filtering.
// The single "WHERE (? IS NULL OR category = ?)" form prevents the planner
// from choosing the category index because the param type isn't known at prepare time.
const SELECT_ALL = `
  SELECT id, amount_paise, category, description, date, created_at
  FROM expenses
  ORDER BY date DESC, created_at DESC
`;

const SELECT_BY_CATEGORY = `
  SELECT id, amount_paise, category, description, date, created_at
  FROM expenses
  WHERE category = ?
  ORDER BY date DESC, created_at DESC
`;

export default async function expensesReadRoute(app: FastifyInstance, { db }: { db: Database }) {
  const stmtAll = db.prepare(SELECT_ALL);
  const stmtByCategory = db.prepare(SELECT_BY_CATEGORY);

  app.get('/expenses', async (request, reply) => {
    const raw = request.query as Record<string, unknown>;

    // Treat empty string category= as omitted
    const normalized = {
      ...raw,
      category: raw.category && String(raw.category).length > 0 ? raw.category : undefined,
    };

    const parsed = QuerySchema.safeParse(normalized);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid query params',
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const { category } = parsed.data;
    const rows = category ? stmtByCategory.all(category) : stmtAll.all();

    return reply.status(200).send(rows);
  });
}
