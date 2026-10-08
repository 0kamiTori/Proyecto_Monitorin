import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
process.env.SMTEL_DB = ':memory:';
process.env.SMTEL_DEMO = 'false';
const { createApp } = await import('../src/app.js');
const { run, db } = await import('../src/db.js');
const { hashPassword, sha256, newSecret } = await import('../src/security.js');
const equipmentCount = Number(process.argv[2] || 200),
  concurrentUsers = Number(process.argv[3] || 100),
  password = 'Load-test-2026!';
if (
  !Number.isInteger(equipmentCount) ||
  equipmentCount < 1 ||
  equipmentCount > 1000 ||
  !Number.isInteger(concurrentUsers) ||
  concurrentUsers < 1 ||
  concurrentUsers > 500
)
  throw new Error('Carga fuera del rango admitido para la prueba local.');
const stamp = new Date().toISOString();
const passwordHash = hashPassword(password);
run(
  'INSERT INTO users(id,name,email,password_hash,role) VALUES (?,?,?,?,?)',
  'load-user',
  'Prueba de carga',
  'load@test.local',
  passwordHash,
  'MEMBER',
);
const clientCookies: string[] = [];
for (let client = 1; client < concurrentUsers; client++) {
  const id = `load-user-${client}`,
    token = newSecret();
  run(
    'INSERT INTO users(id,name,email,password_hash,role) VALUES (?,?,?,?,?)',
    id,
    `Cliente ${client}`,
    `load-${client}@test.local`,
    passwordHash,
    'MEMBER',
  );
  run('INSERT INTO sessions VALUES (?,?,?,?)', sha256(token), id, stamp, stamp);
  clientCookies.push(`smtel_session=${token}`);
}
for (let i = 0; i < equipmentCount; i++) {
  run(
    'INSERT INTO equipment(id,asset_tag,label,state,location,created_at) VALUES (?,?,?,?,?,?)',
    `load-${i}`,
    `LOAD-${i}`,
    `Equipo ${i}`,
    'OPERATIVO',
    JSON.stringify({
      lab: 'Prueba',
      container: `Isla ${Math.floor(i / 10)}`,
      position: `Puesto ${i}`,
      x: i % 10,
      y: Math.floor(i / 10),
    }),
    stamp,
  );
  run(
    'INSERT INTO agents VALUES (?,?,?,?,?,0,?)',
    `agent-${i}`,
    `load-${i}`,
    'linux',
    sha256(`token-${i}`),
    `secret-${i}`,
    stamp,
  );
}
const server = createApp().listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address !== 'object') throw new Error('Servidor no disponible');
const base = `http://127.0.0.1:${address.port}/api`;
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
try {
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'load@test.local', password }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  clientCookies.unshift(cookie);
  let errors = 0;
  const ingestionLatencies: number[] = [],
    queryLatencies: number[] = [];
  for (let round = 0; round < 2; round++) {
    await Promise.all(
      Array.from({ length: equipmentCount }, async (_, i) => {
        const time = new Date().toISOString();
        const body = JSON.stringify({
          id: randomUUID(),
          equipmentId: `load-${i}`,
          osId: 'linux',
          observedAt: time,
          inventory: {
            hostname: `pc-${i}`,
            manufacturer: 'Test',
            model: 'Test',
            serial: `SN-${i}`,
            cpuModel: 'CPU',
            physicalCores: 4,
            logicalCores: 8,
            frequencyMHz: 3000,
            architecture: 'x86_64',
            ramTotalBytes: 16 * 2 ** 30,
            firmware: 'UEFI',
            bootManager: 'GRUB',
            bootType: 'SINGLE',
            bootReason: null,
            bootVerifiedAt: time,
            operatingSystems: [
              {
                id: 'linux',
                name: 'Ubuntu',
                version: '24.04',
                architecture: 'x86_64',
                partition: '/',
                active: true,
                inferred: false,
                agentInstalled: true,
                lastSeen: time,
              },
            ],
            disks: [],
            partitions: [],
            adapters: [],
          },
          metrics: {
            cpuPercent: 40,
            ramPercent: 50,
            ramUsedBytes: 8 * 2 ** 30,
            ramAvailableBytes: 8 * 2 ** 30,
            swapUsedBytes: 0,
            diskPercent: 20,
            networkSentBps: 1000,
            networkReceivedBps: 1000,
          },
        });
        const start = performance.now();
        const response = await fetch(`${base}/ingest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer token-${i}`,
            'X-Smtel-Sent-At': time,
            'X-Smtel-Signature': createHmac('sha256', `secret-${i}`)
              .update(`${time}.${body}`)
              .digest('hex'),
          },
          body,
        });
        await response.arrayBuffer();
        ingestionLatencies.push(performance.now() - start);
        if (!response.ok) errors++;
      }),
    );
    await Promise.all(
      Array.from({ length: concurrentUsers }, async (_, client) => {
        const start = performance.now();
        const response = await fetch(`${base}/dashboard`, {
          headers: { Cookie: clientCookies[client] },
        });
        await response.arrayBuffer();
        queryLatencies.push(performance.now() - start);
        if (!response.ok) errors++;
      }),
    );
  }
  const result = {
    scope:
      'Carga local sintética con SQLite en memoria; sesiones distintas por miembro, ráfagas simultáneas, sin TLS ni persistencia en disco. Las sesiones adicionales se preparan como fixture; no se mide carga de login. No certifica SLA ni capacidad de producción.',
    equipmentCount,
    concurrentUsers,
    ingestionRequests: ingestionLatencies.length,
    dashboardRequests: queryLatencies.length,
    errors,
    ingestionP95Ms: Math.round(percentile(ingestionLatencies, 0.95)),
    dashboardP95Ms: Math.round(percentile(queryLatencies, 0.95)),
    generatedAt: new Date().toISOString(),
  };
  mkdirSync(resolve('../../tmp/validation'), { recursive: true });
  writeFileSync(
    resolve(`../../tmp/validation/load-${equipmentCount}-${concurrentUsers}.json`),
    JSON.stringify(result, null, 2),
  );
  writeFileSync(resolve('../../tmp/validation/load-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (errors) process.exitCode = 1;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
}
