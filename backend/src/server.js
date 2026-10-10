import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase, ensureDatabaseIndexes } from './config/database.js';
import { env } from './config/env.js';
import { assertManilaOffsetIsStable } from './utils/eventTimeZone.js';

async function start() {
  // Fails loudly if Asia/Manila ever stops being UTC+8, instead of quietly
  // storing every event eight hours out.
  assertManilaOffsetIsStable();
  await connectDatabase();
  await ensureDatabaseIndexes();
  const app = await createApp();
  const server = app.listen(env.port, '127.0.0.1', () => {
    console.log(`University Attendance API listening on http://127.0.0.1:${env.port}`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} received; shutting down.`);
    server.close(async () => {
      await app.locals.sessionClient?.close();
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('Failed to start University Attendance API:', error);
  process.exit(1);
});
