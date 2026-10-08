import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTotpSecret, hashPassword, sha256 } from './security.js';
import {
  DEFAULT_TRANSITIONS,
  type Settings,
  type User,
  type Audit,
  type Inventory,
} from '../../../packages/shared/src/index.js';

export const root = resolve(process.cwd(), '../..');
export const production = process.env.SMTEL_PRODUCTION === 'true';
export const demo = !production && process.env.SMTEL_DEMO !== 'false';
const databasePath =
  process.env.SMTEL_DB === ':memory:'
    ? ':memory:'
    : resolve(root, process.env.SMTEL_DB || 'data/smtel.sqlite');
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
export const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  PRAGMA busy_timeout=5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN','MEMBER','SUPPORT')),
    active INTEGER NOT NULL DEFAULT 1,
    totp_secret TEXT,
    last_totp_step INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    last_activity TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS equipment (
    id TEXT PRIMARY KEY,
    asset_tag TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    state TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    demo INTEGER NOT NULL DEFAULT 0,
    location TEXT NOT NULL,
    inventory TEXT,
    last_seen TEXT,
    reporting_interval INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    equipment_id TEXT NOT NULL REFERENCES equipment(id),
    os_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    hmac_secret TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    payload_hash TEXT NOT NULL,
    received_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS metrics (
    id TEXT PRIMARY KEY,
    equipment_id TEXT NOT NULL REFERENCES equipment(id),
    os_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    cpu REAL NOT NULL,
    ram REAL NOT NULL,
    ram_used INTEGER NOT NULL,
    ram_available INTEGER NOT NULL,
    swap_used INTEGER NOT NULL,
    disk REAL NOT NULL,
    net_sent INTEGER NOT NULL,
    net_received INTEGER NOT NULL,
    clock_skew INTEGER NOT NULL,
    delayed INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS metrics_equipment_time ON metrics(equipment_id,observed_at);

  CREATE INDEX IF NOT EXISTS metrics_equipment_receipt ON metrics(equipment_id,received_at);

  CREATE TABLE IF NOT EXISTS os_reports (
    equipment_id TEXT NOT NULL REFERENCES equipment(id),
    os_id TEXT NOT NULL,
    name TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    PRIMARY KEY(equipment_id,os_id)
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    equipment_id TEXT NOT NULL REFERENCES equipment(id),
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    justification TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    requester_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    reviewer_id TEXT REFERENCES users(id),
    reviewed_at TEXT,
    comment TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS one_pending_per_equipment ON requests(equipment_id) WHERE status='PENDING';

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at);

  CREATE TABLE IF NOT EXISTS audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    actor_id TEXT,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    equipment_id TEXT,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );

  CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
  BEGIN
    SELECT RAISE(ABORT,'Auditoría inmutable');
  END;

  CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
  BEGIN
    SELECT RAISE(ABORT,'Auditoría inmutable');
  END;

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );

  INSERT OR IGNORE INTO counters(name,value) VALUES ('accepted',0),('rejected',0);
`);
export const now = () => new Date().toISOString();
export function all<T = Record<string, unknown>>(
  sql: string,
  ...args: (string | number | null)[]
): T[] {
  return db.prepare(sql).all(...args) as T[];
}
export function get<T = Record<string, unknown>>(
  sql: string,
  ...args: (string | number | null)[]
): T | undefined {
  return db.prepare(sql).get(...args) as T | undefined;
}
export function run(sql: string, ...args: (string | number | null)[]) {
  return db.prepare(sql).run(...args);
}
export function transaction<T>(operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export const defaultSettings: Settings = {
  reportingInterval: 30,
  storageInterval: 300,
  offlineIntervals: 3,
  cpuThreshold: 85,
  ramThreshold: 90,
  diskThreshold: 90,
  pendingAlertHours: 24,
  supportCanLocate: true,
  allowSelfApproval: true,
  sessionIdleMinutes: 30,
  metricRetentionDays: 90,
  transitions: DEFAULT_TRANSITIONS,
};
run('INSERT OR IGNORE INTO settings(id,value) VALUES (1,?)', JSON.stringify(defaultSettings));
export function settings(): Settings {
  return JSON.parse(get<{ value: string }>('SELECT value FROM settings WHERE id=1')!.value);
}
export function publicUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role as User['role'],
    active: Boolean(row.active),
  };
}
export function audit(
  actor: User | null,
  action: string,
  equipmentId: string | null,
  detail: Record<string, unknown>,
): void {
  const previousHash =
    get<{ hash: string }>('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1')?.hash ||
    '0'.repeat(64);
  const event = {
    id: randomUUID(),
    actorId: actor?.id || null,
    actorName: actor?.name || 'Agente / sistema',
    action,
    equipmentId,
    detail,
    createdAt: now(),
    previousHash,
  };
  const hash = sha256(JSON.stringify(event));
  run(
    'INSERT INTO audit(id,actor_id,actor_name,action,equipment_id,detail,created_at,previous_hash,hash) VALUES (?,?,?,?,?,?,?,?,?)',
    event.id,
    event.actorId,
    event.actorName,
    action,
    equipmentId,
    JSON.stringify(detail),
    event.createdAt,
    previousHash,
    hash,
  );
}
export function auditRows(equipmentId?: string): Audit[] {
  const rows = equipmentId
    ? all('SELECT * FROM audit WHERE equipment_id=? ORDER BY seq DESC LIMIT 500', equipmentId)
    : all('SELECT * FROM audit ORDER BY seq DESC LIMIT 1000');
  return rows.map((r) => ({
    id: String(r.id),
    actorId: r.actor_id as string | null,
    actorName: String(r.actor_name),
    action: String(r.action),
    equipmentId: r.equipment_id as string | null,
    detail: JSON.parse(String(r.detail)),
    createdAt: String(r.created_at),
    previousHash: String(r.previous_hash),
    hash: String(r.hash),
  }));
}
export function verifyAudit(): boolean {
  let previous = '0'.repeat(64);
  for (const r of all('SELECT * FROM audit ORDER BY seq')) {
    const event = {
      id: r.id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      equipmentId: r.equipment_id,
      detail: JSON.parse(String(r.detail)),
      createdAt: r.created_at,
      previousHash: r.previous_hash,
    };
    if (r.previous_hash !== previous || sha256(JSON.stringify(event)) !== r.hash) return false;
    previous = String(r.hash);
  }
  return true;
}
export function notify(userId: string, title: string, body: string) {
  run(
    'INSERT INTO notifications(id,user_id,title,body,created_at) VALUES (?,?,?,?,?)',
    randomUUID(),
    userId,
    title,
    body,
    now(),
  );
}
export function notifyAdmins(title: string, body: string) {
  for (const user of all<{ id: string }>("SELECT id FROM users WHERE role='ADMIN' AND active=1"))
    notify(user.id, title, body);
}

export function seed(): void {
  if (!get('SELECT id FROM users LIMIT 1')) {
    const email = process.env.SMTEL_ADMIN_EMAIL || (demo ? 'admin@smtel.local' : '');
    const password = process.env.SMTEL_ADMIN_PASSWORD || (demo ? 'SMTEL.demo2026!' : '');
    if (!email || password.length < 12)
      throw new Error(
        'Configure SMTEL_ADMIN_EMAIL y SMTEL_ADMIN_PASSWORD (mínimo 12 caracteres), o habilite SMTEL_DEMO en desarrollo.',
      );
    const secret = createTotpSecret();
    run(
      'INSERT INTO users(id,name,email,password_hash,role,totp_secret) VALUES (?,?,?,?,?,?)',
      'admin',
      'Administrador del laboratorio',
      email.toLowerCase(),
      hashPassword(password),
      'ADMIN',
      secret,
    );
    mkdirSync(resolve(root, 'data'), { recursive: true });
    writeFileSync(
      resolve(root, 'data/bootstrap-mfa.json'),
      JSON.stringify(
        {
          email,
          secret,
          uri: `otpauth://totp/SMTEL:${encodeURIComponent(email)}?secret=${secret}&issuer=SMTEL`,
          instructions:
            'Importe en su autenticador TOTP. Proteja y retire este archivo después de configurar MFA.',
        },
        null,
        2,
      ),
    );
    if (demo) {
      run(
        'INSERT INTO users(id,name,email,password_hash,role) VALUES (?,?,?,?,?)',
        'member',
        'Valentina Torres',
        'miembro@smtel.local',
        hashPassword(password),
        'MEMBER',
      );
      run(
        'INSERT INTO users(id,name,email,password_hash,role) VALUES (?,?,?,?,?)',
        'support',
        'Carlos Ramírez',
        'soporte@smtel.local',
        hashPassword(password),
        'SUPPORT',
      );
    }
    audit(null, 'SYSTEM_BOOTSTRAP', null, { demo, adminEmail: email, mfaRequired: true });
  }
  if (!demo || get('SELECT id FROM equipment LIMIT 1')) return;
  transaction(() => {
    const names = [
      'Estación de desarrollo 01',
      'Estación de desarrollo 02',
      'Estación de desarrollo 03',
      'Estación de desarrollo 04',
      'Servidor de integración',
      'Estación de diseño 01',
      'Estación de pruebas 01',
      'Estación de desarrollo 05',
      'Nodo de cómputo 01',
      'Estación de pruebas 02',
      'Estación de desarrollo 06',
      'Estación de diseño 02',
    ];
    names.forEach((label, i) => {
      const id = `demo-${String(i + 1).padStart(2, '0')}`;
      const multi = [0, 1, 3, 6, 8].includes(i),
        linux = [0, 2, 4, 7, 8, 10].includes(i);
      const activeId = linux ? 'linux-ubuntu' : 'windows-11';
      const operatingSystems = [
        {
          id: activeId,
          name: linux ? 'Ubuntu' : 'Windows',
          version: linux ? '24.04 LTS' : '11 Pro',
          architecture: 'x86_64',
          partition: linux ? '/dev/nvme0n1p3' : 'C:',
          active: true,
          inferred: false,
          agentInstalled: true,
          lastSeen: now(),
        },
      ];
      if (multi)
        operatingSystems.push({
          id: linux ? 'windows-11' : 'linux-ubuntu',
          name: linux ? 'Windows' : 'Ubuntu',
          version: linux ? '11 Pro' : '24.04 LTS',
          architecture: 'x86_64',
          partition: linux ? 'C:' : '/dev/nvme0n1p3',
          active: false,
          inferred: true,
          agentInstalled: i !== 6,
          lastSeen: i === 6 ? '' : new Date(Date.now() - 86400000).toISOString(),
        });
      const inventory: Inventory = {
        hostname: `LAB-DEV-${String(i + 1).padStart(2, '0')}`,
        manufacturer: i === 4 ? 'Dell' : 'Lenovo',
        model: i === 4 ? 'PowerEdge R350' : 'ThinkCentre M90',
        serial: `DEMO-SN-${i + 1}`,
        cpuModel: i === 4 ? 'Intel Xeon E-2336' : 'Intel Core i7-12700',
        physicalCores: 12,
        logicalCores: 20,
        frequencyMHz: 3600,
        architecture: 'x86_64',
        ramTotalBytes: (i === 4 || i === 8 ? 64 : 32) * 2 ** 30,
        firmware: 'UEFI',
        bootManager: multi
          ? 'GRUB / Windows Boot Manager'
          : linux
            ? 'GRUB'
            : 'Windows Boot Manager',
        bootType: i === 9 ? 'UNKNOWN' : multi ? 'MULTI' : 'SINGLE',
        bootReason: i === 9 ? 'Particiones cifradas; requiere verificación manual.' : null,
        bootVerifiedAt: now(),
        operatingSystems: operatingSystems.map((os) => ({ ...os, lastSeen: os.lastSeen || null })),
        disks: [
          { name: 'NVMe 0', model: 'Samsung 980 PRO', type: 'NVMe', totalBytes: 1000 * 2 ** 30 },
        ],
        partitions: [
          {
            disk: 'NVMe 0',
            name: linux ? '/dev/nvme0n1p3' : 'C:',
            filesystem: linux ? 'ext4' : 'NTFS',
            mountpoint: linux ? '/' : 'C:\\',
            totalBytes: 500 * 2 ** 30,
            usedBytes: (120 + i * 20) * 2 ** 30,
            os: activeId,
          },
        ],
        adapters: [
          {
            name: 'Ethernet',
            mac: `02:00:00:00:01:${i.toString(16).padStart(2, '0')}`,
            ipv4: [`192.168.10.${20 + i}`],
            ipv6: [],
            up: true,
            speedMbps: 1000,
            bytesSent: 100000,
            bytesReceived: 500000,
          },
        ],
      };
      const state =
        i === 5 || i === 9
          ? 'MANTENIMIENTO'
          : i === 11
            ? 'FUERA_SERVICIO'
            : i === 10
              ? 'REASIGNADO'
              : 'OPERATIVO';
      const location = {
        lab: 'Laboratorio de desarrollo',
        container: i === 4 || i === 8 ? 'Rack 01' : i < 4 ? 'Isla A' : i < 8 ? 'Isla B' : 'Isla C',
        position: i === 4 || i === 8 ? `U${i + 1}` : `Puesto ${(i % 4) + 1}`,
        x: 2 + (i % 4) * 3,
        y: 2 + Math.floor(i / 4) * 3,
      };
      run(
        'INSERT INTO equipment(id,asset_tag,label,state,demo,location,inventory,last_seen,created_at) VALUES (?,?,?,?,1,?,?,?,?)',
        id,
        `SMT-${String(i + 1).padStart(3, '0')}`,
        label,
        state,
        JSON.stringify(location),
        JSON.stringify(inventory),
        i === 9 || i === 11 ? new Date(Date.now() - 1800000).toISOString() : now(),
        now(),
      );
      for (let point = 59; point >= 0; point--) {
        const time = new Date(Date.now() - point * 30000).toISOString();
        const cpu = i === 4 ? 88 + Math.sin(point) * 5 : 18 + i * 2 + Math.sin(point / 5 + i) * 10;
        const ram = 38 + i * 3 + Math.sin(point / 9) * 3;
        run(
          'INSERT INTO metrics VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          randomUUID(),
          id,
          activeId,
          time,
          time,
          cpu,
          ram,
          Math.round((inventory.ramTotalBytes * ram) / 100),
          Math.round(inventory.ramTotalBytes * (1 - ram / 100)),
          0,
          24 + i * 4,
          20000 + i * 3000,
          65000 + i * 5000,
          0,
          0,
        );
      }
      audit(null, 'EQUIPMENT_CREATED', id, {
        label,
        assetTag: `SMT-${String(i + 1).padStart(3, '0')}`,
        location,
        demo: true,
      });
    });
    run(
      'INSERT INTO requests(id,equipment_id,from_state,to_state,justification,status,requester_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
      randomUUID(),
      'demo-03',
      'OPERATIVO',
      'MANTENIMIENTO',
      'El ventilador presenta ruido; se solicita revisión y limpieza preventiva.',
      'PENDING',
      'member',
      new Date(Date.now() - 3600000).toISOString(),
    );
    notifyAdmins('Nueva solicitud de mantenimiento', 'Valentina Torres solicita revisar SMT-003.');
  });
}
