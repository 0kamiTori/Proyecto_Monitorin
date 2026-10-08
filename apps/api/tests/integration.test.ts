import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac, randomUUID } from 'node:crypto';
process.env.SMTEL_DB = ':memory:';
process.env.SMTEL_DEMO = 'false';
const { createApp } = await import('../src/app.js');
const { db, run, get, all, defaultSettings, verifyAudit } = await import('../src/db.js');
const { hashPassword, totp, createTotpSecret, sha256 } = await import('../src/security.js');
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let base = '';
const password = 'Integration-2026!';
const tokens: Record<string, string> = {};
const secrets: Record<string, string> = {};
const hmacSecret = 'test-signature-secret',
  agentToken = 'test-device-token';

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});
async function call(
  path: string,
  method = 'GET',
  body?: unknown,
  role = 'member',
  extra: Record<string, string> = {},
) {
  const result = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
      ...(tokens[role] ? { Cookie: tokens[role] } : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const content = await result.text();
  return {
    status: result.status,
    headers: result.headers,
    body: content.startsWith('{') || content.startsWith('[') ? JSON.parse(content) : content,
  };
}
beforeEach(async () => {
  for (const table of [
    'sessions',
    'notifications',
    'receipts',
    'metrics',
    'requests',
    'os_reports',
    'agents',
    'equipment',
    'users',
  ])
    run(`DELETE FROM ${table}`);
  run('UPDATE settings SET value=? WHERE id=1', JSON.stringify(defaultSettings));
  for (const [id, role] of [
    ['admin', 'ADMIN'],
    ['member', 'MEMBER'],
    ['support', 'SUPPORT'],
  ]) {
    secrets[id] = createTotpSecret();
    run(
      'INSERT INTO users(id,name,email,password_hash,role,totp_secret) VALUES (?,?,?,?,?,?)',
      id,
      id,
      `${id}@test.local`,
      hashPassword(password),
      role,
      role === 'ADMIN' ? secrets[id] : null,
    );
    const login = await call(
      '/auth/login',
      'POST',
      {
        email: `${id}@test.local`,
        password,
        ...(role === 'ADMIN' ? { totp: totp(secrets[id]) } : {}),
      },
      'anonymous',
    );
    assert.equal(login.status, 200);
    tokens[id] = login.headers.get('set-cookie')!.split(';')[0];
  }
  const stamp = new Date().toISOString();
  run(
    'INSERT INTO equipment(id,asset_tag,label,state,location,created_at) VALUES (?,?,?,?,?,?)',
    'pc',
    'PC-01',
    'Equipo de pruebas',
    'OPERATIVO',
    JSON.stringify({ lab: 'Lab', container: 'Isla A', position: 'Puesto 1', x: 1, y: 2 }),
    stamp,
  );
  run(
    'INSERT INTO agents VALUES (?,?,?,?,?,0,?)',
    'agent',
    'pc',
    'linux',
    sha256(agentToken),
    hmacSecret,
    stamp,
  );
});
function sampleReport() {
  const time = new Date().toISOString();
  return {
    id: randomUUID(),
    equipmentId: 'pc',
    osId: 'linux',
    observedAt: time,
    inventory: {
      hostname: 'test-pc',
      manufacturer: 'Test',
      model: 'Test',
      serial: 'SN-01',
      cpuModel: 'Test CPU',
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
          partition: '/dev/sda2',
          active: true,
          inferred: false,
          agentInstalled: true,
          lastSeen: time,
        },
      ],
      disks: [{ name: '/dev/sda', model: 'SSD', type: 'SSD', totalBytes: 500 * 2 ** 30 }],
      partitions: [
        {
          disk: '/dev/sda',
          name: '/dev/sda2',
          filesystem: 'ext4',
          mountpoint: '/',
          totalBytes: 500 * 2 ** 30,
          usedBytes: 100 * 2 ** 30,
          os: 'linux',
        },
      ],
      adapters: [],
    },
    metrics: {
      cpuPercent: 42,
      ramPercent: 50,
      ramUsedBytes: 8 * 2 ** 30,
      ramAvailableBytes: 8 * 2 ** 30,
      swapUsedBytes: 0,
      diskPercent: 20,
      networkSentBps: 1000,
      networkReceivedBps: 2000,
    },
  };
}
function sendReport(
  report: ReturnType<typeof sampleReport>,
  signature?: string,
  token = agentToken,
  sentAt = new Date().toISOString(),
) {
  return call('/ingest', 'POST', report, 'anonymous', {
    Authorization: `Bearer ${token}`,
    'X-Smtel-Sent-At': sentAt,
    'X-Smtel-Signature':
      signature ||
      createHmac('sha256', hmacSecret)
        .update(`${sentAt}.${JSON.stringify(report)}`)
        .digest('hex'),
  });
}

test('autenticación obligatoria, MFA admin y protección de origen', async () => {
  assert.equal((await call('/dashboard', 'GET', undefined, 'anonymous')).status, 401);
  assert.equal((await call('/audit')).status, 403);
  assert.equal((await call('/users', 'GET', undefined, 'support')).status, 403);
  const missing = await call(
    '/auth/login',
    'POST',
    { email: 'admin@test.local', password },
    'anonymous',
  );
  assert.equal(missing.status, 401);
  assert.equal(missing.body.mfaRequired, true);
  assert.equal(
    (
      await call(
        '/auth/login',
        'POST',
        { email: 'admin@test.local', password, totp: totp(secrets.admin) },
        'anonymous',
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        '/requests',
        'POST',
        { equipmentId: 'pc', toState: 'MANTENIMIENTO', justification: 'Mantenimiento preventivo' },
        'member',
        { Origin: 'https://external.invalid' },
      )
    ).status,
    403,
  );
});
test('solicitud conserva estado; solo admin aprueba y aplica una transacción auditada', async () => {
  const input = {
    equipmentId: 'pc',
    toState: 'MANTENIMIENTO',
    justification: 'Revisión preventiva del ventilador',
  };
  const requested = await call('/requests', 'POST', input);
  assert.equal(requested.status, 201);
  assert.equal(
    get<{ state: string }>('SELECT state FROM equipment WHERE id=?', 'pc')!.state,
    'OPERATIVO',
  );
  assert.equal((await call('/requests', 'POST', input)).status, 409);
  assert.equal(
    (await call(`/requests/${requested.body.id}/resolve`, 'POST', { decision: 'APPROVED' })).status,
    403,
  );
  assert.equal(
    (
      await call(
        `/requests/${requested.body.id}/resolve`,
        'POST',
        { decision: 'REJECTED', comment: 'No procede' },
        'support',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        `/requests/${requested.body.id}/resolve`,
        'POST',
        { decision: 'REJECTED', comment: '' },
        'admin',
      )
    ).status,
    422,
  );
  const approved = await call(
    `/requests/${requested.body.id}/resolve`,
    'POST',
    { decision: 'APPROVED', comment: 'Autorizado' },
    'admin',
  );
  assert.equal(approved.status, 200);
  assert.equal(
    get<{ state: string }>('SELECT state FROM equipment WHERE id=?', 'pc')!.state,
    'MANTENIMIENTO',
  );
  const event = get<{ detail: string }>(
    "SELECT detail FROM audit WHERE action='STATE_APPROVED' ORDER BY seq DESC LIMIT 1",
  )!;
  assert.equal(JSON.parse(event.detail).requesterId, 'member');
  assert.equal(JSON.parse(event.detail).reviewerId, 'admin');
  assert.equal(
    (
      await call(
        `/requests/${requested.body.id}/resolve`,
        'POST',
        { decision: 'APPROVED' },
        'admin',
      )
    ).status,
    409,
  );
  assert.equal(verifyAudit(), true);
});
test('rechazo y cancelación conservan estado; cancelación solo por solicitante', async () => {
  const request = await call('/requests', 'POST', {
    equipmentId: 'pc',
    toState: 'FUERA_SERVICIO',
    justification: 'Se detectó una falla de hardware',
  });
  assert.equal(
    (
      await call(
        `/requests/${request.body.id}/resolve`,
        'POST',
        { decision: 'CANCELLED' },
        'support',
      )
    ).status,
    403,
  );
  assert.equal(
    (await call(`/requests/${request.body.id}/resolve`, 'POST', { decision: 'CANCELLED' })).status,
    200,
  );
  const second = await call('/requests', 'POST', {
    equipmentId: 'pc',
    toState: 'MANTENIMIENTO',
    justification: 'Mantenimiento preventivo de hardware',
  });
  assert.equal(
    (
      await call(
        `/requests/${second.body.id}/resolve`,
        'POST',
        { decision: 'REJECTED', comment: 'Ya se realizó mantenimiento.' },
        'admin',
      )
    ).status,
    200,
  );
  assert.equal(
    get<{ state: string }>('SELECT state FROM equipment WHERE id=?', 'pc')!.state,
    'OPERATIVO',
  );
  assert.equal(all('SELECT * FROM notifications WHERE user_id=?', 'member').length, 2);
});
test('matriz, justificación y segregación se validan en servidor', async () => {
  run("UPDATE equipment SET state='REASIGNADO' WHERE id='pc'");
  assert.equal(
    (
      await call('/requests', 'POST', {
        equipmentId: 'pc',
        toState: 'FUERA_SERVICIO',
        justification: 'Solicitud de baja del equipo',
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call('/requests', 'POST', {
        equipmentId: 'pc',
        toState: 'OPERATIVO',
        justification: '',
      })
    ).status,
    422,
  );
  run(
    'UPDATE settings SET value=? WHERE id=1',
    JSON.stringify({ ...defaultSettings, allowSelfApproval: false }),
  );
  const request = await call(
    '/requests',
    'POST',
    { equipmentId: 'pc', toState: 'OPERATIVO', justification: 'Equipo listo para su uso habitual' },
    'admin',
  );
  assert.equal(
    (await call(`/requests/${request.body.id}/resolve`, 'POST', { decision: 'APPROVED' }, 'admin'))
      .status,
    403,
  );
});
test('ubicación transaccional, permisos de Soporte y auditoría inmutable', async () => {
  const location = { lab: 'Lab 2', container: 'Rack 1', position: 'U12', x: 2, y: 3 };
  assert.equal((await call('/equipment/pc/location', 'PATCH', location)).status, 403);
  assert.equal((await call('/equipment/pc/location', 'PATCH', location, 'support')).status, 200);
  assert.equal(
    JSON.parse(
      get<{ location: string }>('SELECT location FROM equipment WHERE id=?', 'pc')!.location,
    ).container,
    'Rack 1',
  );
  const history = (await call('/equipment/pc')).body.history;
  assert.equal(history[0].action, 'LOCATION_CHANGED');
  assert.throws(() => run("UPDATE audit SET action='ALTERED'"), /inmutable/);
  assert.throws(() => run('DELETE FROM audit'), /inmutable/);
  assert.equal(verifyAudit(), true);
});
test('ingestión HMAC: duplicados idempotentes, alteraciones y revocación', async () => {
  const report = sampleReport();
  const first = await sendReport(report);
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, false);
  const retry = await sendReport(report);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(all('SELECT id FROM metrics').length, 1);
  const changed = structuredClone(report);
  changed.metrics.cpuPercent = 75;
  assert.equal((await sendReport(changed)).status, 409);
  assert.equal((await sendReport({ ...report, id: randomUUID() }, '0'.repeat(64))).status, 401);
  run("UPDATE agents SET revoked=1 WHERE id='agent'");
  assert.equal((await sendReport({ ...report, id: randomUUID() })).status, 401);
});
test('validación de rangos, identidad y SO activo en ingestión', async () => {
  const report = sampleReport();
  report.metrics.cpuPercent = 120;
  assert.equal((await sendReport(report)).status, 422);
  report.metrics.cpuPercent = 40;
  report.equipmentId = 'otro-equipo';
  assert.equal((await sendReport(report)).status, 403);
  report.equipmentId = 'pc';
  report.inventory.operatingSystems[0].active = false;
  assert.equal((await sendReport(report)).status, 422);
});
test('cola retrasada conserva hora original y no vuelve a poner en línea al equipo', async () => {
  const report = sampleReport();
  report.observedAt = new Date(Date.now() - 86400000).toISOString();
  report.inventory.bootVerifiedAt = report.observedAt;
  assert.equal((await sendReport(report)).status, 200);
  const dashboard = (await call('/dashboard')).body;
  assert.equal(dashboard.equipment[0].online, false);
  assert.equal(dashboard.equipment[0].latestMetric.delayed, true);
  assert.equal(dashboard.equipment[0].latestMetric.observedAt, report.observedAt);
});
test('SO inactivo no apaga el equipo y el cambio de SO queda registrado', async () => {
  const report = sampleReport();
  report.inventory.bootType = 'MULTI';
  report.inventory.operatingSystems.push({
    ...report.inventory.operatingSystems[0],
    id: 'windows',
    name: 'Windows',
    partition: 'C:',
    active: false,
    inferred: true,
    agentInstalled: false,
  });
  assert.equal((await sendReport(report)).status, 200);
  const equipment = (await call('/dashboard')).body.equipment[0];
  assert.equal(equipment.online, true);
  assert.equal(equipment.inventory.operatingSystems[1].agentInstalled, false);
  assert.equal((await call('/equipment/pc')).body.history[0].action, 'BOOT_CHANGED');
});
test('desvío del reloj se detecta usando la hora de envío firmada', async () => {
  const report = sampleReport();
  const sentAt = new Date(Date.now() - 300000).toISOString();
  assert.equal((await sendReport(report, undefined, agentToken, sentAt)).status, 200);
  const equipment = (await call('/dashboard')).body.equipment[0];
  assert.equal(equipment.latestMetric.clockSkew, true);
  assert.equal(equipment.online, false);
});
test('una fecha futura inválida no desplaza las mediciones posteriores correctas', async () => {
  const future = sampleReport();
  future.observedAt = new Date(Date.now() + 86400000).toISOString();
  future.inventory.bootVerifiedAt = future.observedAt;
  assert.equal((await sendReport(future)).status, 200);
  const valid = sampleReport();
  valid.metrics.cpuPercent = 21;
  assert.equal((await sendReport(valid)).status, 200);
  const equipment = (await call('/dashboard')).body.equipment[0];
  assert.equal(equipment.latestMetric.id, valid.id);
  assert.equal(equipment.latestMetric.cpuPercent, 21);
  assert.equal(equipment.online, true);
});
test('sesión expira por inactividad; sondeo automático no la extiende', async () => {
  const old = new Date(Date.now() - 31 * 60000).toISOString();
  run('UPDATE sessions SET last_activity=? WHERE user_id=?', old, 'member');
  assert.equal((await call('/dashboard')).status, 401);
});
test('reportes CSV neutralizan fórmulas y PDF exporta datos reales almacenados', async () => {
  run("UPDATE equipment SET label='=HYPERLINK(test)' WHERE id='pc'");
  const csv = await call('/reports/csv?type=inventory');
  assert.equal(csv.status, 200);
  assert.match(csv.body, /'=HYPERLINK/);
  const result = await fetch(`${base}/api/reports/pdf?type=inventory`, {
    headers: { Cookie: tokens.member },
  });
  assert.equal(result.status, 200);
  const bytes = Buffer.from(await result.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
});
