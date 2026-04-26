import db from './db.js';
import { buildApp } from './app.js';

// Expire idempotency keys older than 7 days on every deploy.
// A background TTL would be more precise, but a startup sweep is simpler and
// sufficient — keys only need to survive the window in which clients retry
// (minutes to hours, never days).
const { changes } = db.prepare(
  `DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-7 days')`
).run();
if (changes > 0) {
  console.log(`[startup] pruned ${changes} expired idempotency key(s)`);
}

const app = buildApp(db, { logger: true });

const shutdown = async () => {
  await app.close();
  db.close();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
