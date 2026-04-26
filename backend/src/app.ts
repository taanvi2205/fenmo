import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import expensesWriteRoute from './routes/expenses.js';
import expensesReadRoute from './routes/expenses-read.js';

export function buildApp(db: Database, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger
      ? { level: 'info', redact: ['req.headers.authorization'] }
      : false,
    bodyLimit: 10 * 1024, // 10 KB — plenty for an expense, prevents oversized payloads
  });

  // Real health check — actually queries SQLite so Render's probe catches DB failures
  app.get('/health', async (_req, reply) => {
    try {
      db.prepare('SELECT 1').get();
      return reply.send({ status: 'ok', db: 'connected' });
    } catch {
      return reply.status(503).send({ status: 'degraded', db: 'error' });
    }
  });

  // Log the Idempotency-Key on every POST so it's traceable in production logs
  app.addHook('onRequest', async (request) => {
    if (request.method === 'POST') {
      const key = request.headers['idempotency-key'];
      request.log.info({ idempotency_key: key ?? null }, 'POST request');
    }
  });

  app.register(expensesWriteRoute, { db });
  app.register(expensesReadRoute, { db });

  return app;
}
