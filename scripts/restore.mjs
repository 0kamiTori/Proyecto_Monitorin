import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
if (!process.argv.includes('--services-stopped'))
  throw new Error(
    'Detenga la API y los agentes antes de restaurar; confirme con --services-stopped.',
  );
const source = resolve(process.argv[2] || ''),
  target = resolve(process.argv[3] || 'data/smtel.sqlite');
if (!process.argv[2] || !existsSync(source) || source === target)
  throw new Error('Indique un respaldo válido y un destino distinto.');
const db = new DatabaseSync(source, { readOnly: true });
if (Object.values(db.prepare('PRAGMA integrity_check').get())[0] !== 'ok') {
  db.close();
  throw new Error('El respaldo no pasó la validación.');
}
mkdirSync(dirname(target), { recursive: true });
const existing = existsSync(target);
if (existing) {
  const current = new DatabaseSync(target);
  try {
    await backup(current, `${target}.before-restore-${Date.now()}`);
    current.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    current.close();
  }
}
try {
  await backup(db, target);
  console.log(
    `Restauración completada: ${target}. ${existing ? 'Se conservó una copia de la base anterior.' : 'Se creó una base nueva.'}`,
  );
} finally {
  db.close();
}
