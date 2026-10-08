import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const source = resolve(process.argv[2] || 'data/smtel.sqlite');
const target = resolve(
  process.argv[3] || `backups/smtel-${new Date().toISOString().replaceAll(':', '-')}.sqlite`,
);
if (!existsSync(source)) throw new Error('Base de datos de origen inexistente.');
if (existsSync(target) || source === target)
  throw new Error('El destino debe ser un archivo nuevo.');
mkdirSync(dirname(target), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, target);
  const copy = new DatabaseSync(target, { readOnly: true });
  const result = copy.prepare('PRAGMA integrity_check').get();
  copy.close();
  if (Object.values(result)[0] !== 'ok')
    throw new Error('El respaldo no pasó la validación de integridad.');
  console.log(`Respaldo verificado: ${target}`);
} finally {
  db.close();
}
