import { createApp } from './app.js';
import { seed, db, demo, settings, root, run, now } from './db.js';
import { simulateDemo } from './domain.js';
seed();
const port = Number(process.env.PORT || 4000),
  host = process.env.HOST || '127.0.0.1';
const server = createApp().listen(port, host, () => {
  console.log(`SMTEL API: http://${host}:${port}`);
  if (demo)
    console.log('Modo demostración: datos sintéticos. MFA inicial en data/bootstrap-mfa.json.');
  console.log(`Proyecto: ${root}`);
});
let elapsed = 0;
const timer = setInterval(() => {
  elapsed += 5;
  if (demo && elapsed >= settings().reportingInterval) {
    simulateDemo();
    elapsed = 0;
  }
}, 5000);
const maintenance = setInterval(() => {
  run(
    'DELETE FROM metrics WHERE observed_at<?',
    new Date(Date.now() - settings().metricRetentionDays * 86400000).toISOString(),
  );
  run('DELETE FROM sessions WHERE created_at<?', new Date(Date.now() - 86400000).toISOString());
}, 3600000);
const shutdown = () => {
  clearInterval(timer);
  clearInterval(maintenance);
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
