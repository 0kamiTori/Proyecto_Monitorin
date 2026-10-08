import { readFileSync } from 'node:fs';
import { reportSchema } from '../apps/api/dist/apps/api/src/schemas.js';
const report = JSON.parse(readFileSync('tmp/validation/agent-report.json', 'utf8'));
const validated = reportSchema.parse(report);
console.log(
  `Contrato Python → TypeScript validado. Arranque: ${validated.inventory.bootType}; particiones: ${validated.inventory.partitions.length}; adaptadores: ${validated.inventory.adapters.length}.`,
);
