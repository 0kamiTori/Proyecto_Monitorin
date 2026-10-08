import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/playwright');
const { chromium } = await import('@playwright/test');
const out = resolve('tmp/e2e');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1060 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const ensure = async (text) => {
  await page.getByRole('heading', { name: text, exact: true }).waitFor();
};
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest();
  return ((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
try {
  await page.goto('http://127.0.0.1:5173');
  await page.getByText('Acceso al entorno de demostración', { exact: true }).click();
  await page.getByRole('button', { name: 'Miembro', exact: true }).click();
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await ensure('Todo bajo observación.');
  await page.getByText('Últimas mediciones del equipo seleccionado').waitFor();
  await page.locator('.recharts-area').first().waitFor();
  await page.screenshot({ path: resolve(out, 'overview-desktop.png'), fullPage: true });
  if (process.argv.includes('--mobile-only')) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () =>
        document.querySelector('.sidebar').getBoundingClientRect().right <= 0 &&
        document.documentElement.scrollWidth <= window.innerWidth,
    );
    await page.screenshot({ path: resolve(out, 'overview-mobile.png'), fullPage: true });
    console.log('Móvil OK: documento sin desbordamiento horizontal.');
    await browser.close();
    process.exit(0);
  }
  await page.getByRole('button', { name: 'Mis solicitudes', exact: false }).click();
  const oldRequests = page
    .locator('.request-card')
    .filter({ hasText: 'Verificación automatizada de mantenimiento' });
  while (await oldRequests.count()) {
    const oldText = await oldRequests.first().locator('.justification').innerText();
    await oldRequests
      .first()
      .getByRole('button', { name: 'Cancelar solicitud', exact: true })
      .click();
    await page.getByRole('button', { name: 'Confirmar cancelación', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByText(oldText, { exact: true }).waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: 'Equipos', exact: true }).click();
  await page.getByRole('textbox', { name: 'Buscar equipos' }).fill('SMT-002');
  await page.getByRole('button', { name: 'Ver SMT-002', exact: true }).click();
  await ensure('Estación de desarrollo 02');
  const target = (await page.locator('.page-heading .badge').innerText()).includes('mantenimiento')
    ? 'OPERATIVO'
    : 'MANTENIMIENTO';
  await page.getByRole('button', { name: 'Solicitar cambio', exact: true }).click();
  await page.getByLabel('Estado solicitado').selectOption(target);
  const justification = `Verificación automatizada de mantenimiento ${Date.now()}`;
  await page.getByLabel('Justificación', { exact: true }).fill(justification);
  await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Mis solicitudes', exact: false }).click();
  await page.getByText(justification, { exact: true }).waitFor();
  if (await page.getByRole('button', { name: 'Aprobar', exact: true }).count())
    throw new Error('Miembro tiene acción de aprobación visible.');
  await page.screenshot({ path: resolve(out, 'member-requests.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await ensure('Ingresa a tu laboratorio');
  const bootstrap = JSON.parse(readFileSync(resolve('data/bootstrap-mfa.json'), 'utf8'));
  await page.getByLabel('Correo electrónico', { exact: true }).fill(bootstrap.email);
  await page
    .getByLabel('Contraseña', { exact: true })
    .fill(process.env.SMTEL_ADMIN_PASSWORD || 'SMTEL.demo2026!');
  await page.getByLabel('Código de autenticación', { exact: false }).fill(totp(bootstrap.secret));
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await ensure('Todo bajo observación.');
  await page.getByRole('button', { name: 'Aprobaciones', exact: false }).click();
  await ensure('Decisiones con contexto.');
  const request = page.locator('.request-card').filter({ hasText: justification });
  await request.getByRole('button', { name: 'Aprobar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar aprobación', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Aprobadas', exact: false }).click();
  await page.getByText(justification, { exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'admin-approvals.png'), fullPage: true });
  await page.getByRole('button', { name: 'Equipos', exact: true }).click();
  await page.getByRole('textbox', { name: 'Buscar equipos' }).fill('SMT-002');
  const row = page.locator('tbody tr').filter({ hasText: 'SMT-002' });
  await row
    .getByText(target === 'OPERATIVO' ? 'Operativo' : 'En mantenimiento', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Plano del laboratorio', exact: true }).click();
  await ensure('Tu laboratorio, en el mapa.');
  await page.screenshot({ path: resolve(out, 'map-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Reportes', exact: true }).click();
  await ensure('La historia, en tus manos.');
  const download = page.waitForEvent('download');
  await page
    .locator('.report-card')
    .filter({ hasText: 'Inventario de equipos' })
    .getByRole('button', { name: 'PDF', exact: true })
    .click();
  await (await download).saveAs(resolve(out, 'inventory.pdf'));
  await page.getByRole('button', { name: 'Administración', exact: true }).click();
  await page.getByRole('button', { name: 'Auditoría', exact: true }).click();
  await page.getByText('Cadena verificada', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'audit-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Resumen general', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      document.querySelector('.sidebar').getBoundingClientRect().right <= 0 &&
      document.documentElement.scrollWidth <= window.innerWidth,
  );
  await page.screenshot({ path: resolve(out, 'overview-mobile.png'), fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw new Error('El diseño móvil desborda horizontalmente.');
  await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.getByRole('button', { name: 'Equipos', exact: true }).click();
  await ensure('Cada equipo, en detalle.');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    'E2E OK: acceso por roles, MFA, solicitud, aprobación, mapa, PDF, auditoría y navegación móvil.',
  );
  console.log(`Capturas: ${out}`);
} catch (error) {
  console.log(
    await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      scrollX: window.scrollX,
      sidebar: document.querySelector('.sidebar')?.getBoundingClientRect().toJSON(),
      overflow: [...document.querySelectorAll('body *')]
        .map((el) => ({
          tag: el.tagName,
          class: el.getAttribute('class'),
          rect: el.getBoundingClientRect().toJSON(),
        }))
        .filter((el) => el.rect.right > window.innerWidth + 1 && el.rect.width > 0)
        .slice(0, 15),
    })),
  );
  await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true });
  throw error;
} finally {
  await browser.close();
}
