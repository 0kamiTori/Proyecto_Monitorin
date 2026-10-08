import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { z, ZodError } from 'zod';
import {
  all,
  get,
  run,
  transaction,
  settings,
  publicUser,
  audit,
  auditRows,
  verifyAudit,
  now,
  demo,
  production,
  root,
} from './db.js';
import {
  newSecret,
  sha256,
  hashPassword,
  verifyPassword,
  createTotpSecret,
  verifiedTotpStep,
  validHmac,
} from './security.js';
import {
  alerts,
  equipmentList,
  equipmentById,
  requestList,
  createRequest,
  resolveRequest,
  ingest,
  metric,
  HttpError,
  fail,
} from './domain.js';
import { locationSchema, reportSchema, requestSchema, settingsSchema } from './schemas.js';
import { STATE_LABELS, type User } from '../../../packages/shared/src/index.js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      rawBody?: Buffer;
      sessionHash?: string;
    }
  }
}
const param = (req: Request, key: string) => String(req.params[key]);
const authorize =
  (...roles: User['role'][]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role))
      return next(new HttpError(403, 'No tiene permisos para esta operación.'));
    next();
  };
const origin = process.env.SMTEL_ORIGIN || 'http://localhost:5173';
if (production && !origin.startsWith('https://'))
  throw new Error('SMTEL_ORIGIN debe ser HTTPS en producción.');
export function createApp() {
  const app = express();
  let dashboardSnapshot: {
    until: number;
    prefix: string;
    requests: ReturnType<typeof requestList>;
  } | null = null;
  app.use((req, res, next) => {
    res.on('finish', () => {
      if (req.method !== 'GET' && res.statusCode < 400) dashboardSnapshot = null;
    });
    next();
  });
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
        },
      },
    }),
  );
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buffer) => {
        (req as Request).rawBody = Buffer.from(buffer);
      },
    }),
  );
  const failures = new Map<string, { count: number; until: number }>();
  app.use('/api', (req, _res, next) => {
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      !req.path.startsWith('/ingest')
    ) {
      const requestOrigin = req.get('origin');
      const allowed = production
        ? [origin]
        : [origin, 'http://127.0.0.1:5173', 'http://localhost:4000', 'http://127.0.0.1:4000'];
      if (!requestOrigin || !allowed.includes(requestOrigin))
        return next(new HttpError(403, 'Origen de la solicitud no autorizado.'));
    }
    next();
  });
  app.post('/api/auth/login', (req, res) => {
    const input = z
      .object({
        email: z.email().max(200),
        password: z.string().max(200),
        totp: z.string().max(6).optional(),
      })
      .parse(req.body);
    const key = `${req.ip}:${input.email.toLowerCase()}`;
    const attempt = failures.get(key);
    if (attempt && attempt.until > Date.now() && attempt.count >= 5)
      fail(429, 'Demasiados intentos. Intente nuevamente en 15 minutos.');
    const row = get('SELECT * FROM users WHERE email=? AND active=1', input.email.toLowerCase());
    const reject = (): never => {
      const current =
        attempt && attempt.until > Date.now() ? attempt : { count: 0, until: Date.now() + 900000 };
      failures.set(key, { ...current, count: current.count + 1 });
      return fail(401, 'Credenciales o código de verificación incorrectos.');
    };
    if (!row || !verifyPassword(input.password, String(row.password_hash))) reject();
    if (row!.role === 'ADMIN') {
      if (!input.totp) {
        res.status(401).json({ error: 'Ingrese el código de su autenticador.', mfaRequired: true });
        return;
      }
      const step = verifiedTotpStep(String(row!.totp_secret), input.totp);
      if (step === null) return reject();
      if (row!.last_totp_step !== null && Number(row!.last_totp_step) >= step)
        fail(401, 'El código ya fue utilizado. Espere al siguiente código de su autenticador.');
      run('UPDATE users SET last_totp_step=? WHERE id=?', step!, String(row!.id));
    }
    failures.delete(key);
    const token = newSecret();
    run('INSERT INTO sessions VALUES (?,?,?,?)', sha256(token), String(row!.id), now(), now());
    res.cookie('smtel_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: production,
      path: '/',
      maxAge: 86400000,
    });
    audit(publicUser(row!), 'SESSION_STARTED', null, {});
    res.json({ user: publicUser(row!) });
  });
  app.post('/api/ingest', (req, res) => {
    try {
      const token = req.get('authorization')?.replace(/^Bearer /, '') || '';
      const agent = get('SELECT * FROM agents WHERE token_hash=? AND revoked=0', sha256(token));
      const sentAt = req.get('x-smtel-sent-at') || '';
      const signed = Buffer.concat([Buffer.from(`${sentAt}.`), req.rawBody || Buffer.alloc(0)]);
      if (
        !agent ||
        !z.iso.datetime({ offset: true }).safeParse(sentAt).success ||
        !validHmac(String(agent.hmac_secret), signed, req.get('x-smtel-signature') || '')
      )
        fail(401, 'Agente, fecha de envío o firma no válidos.');
      const report = reportSchema.parse(req.body);
      const result = ingest(agent!, report, req.rawBody!, sentAt);
      res.json({
        ...result,
        settings: {
          reportingInterval: settings().reportingInterval,
          storageInterval: settings().storageInterval,
        },
        serverTime: now(),
      });
    } catch (error) {
      run("UPDATE counters SET value=value+1 WHERE name='rejected'");
      throw error;
    }
  });
  app.use('/api', (req, _res, next) => {
    const cookie = req
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('smtel_session='))
      ?.slice('smtel_session='.length);
    if (!cookie || !/^[a-f0-9]{64}$/.test(cookie))
      return next(new HttpError(401, 'Inicie sesión para continuar.'));
    const hash = sha256(cookie);
    const row = get(
      'SELECT u.*,s.last_activity,s.created_at AS session_created FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.active=1',
      hash,
    );
    if (
      !row ||
      Date.now() - Date.parse(String(row.last_activity)) > settings().sessionIdleMinutes * 60000 ||
      Date.now() - Date.parse(String(row.session_created)) > 86400000
    ) {
      run('DELETE FROM sessions WHERE token_hash=?', hash);
      return next(new HttpError(401, 'La sesión expiró. Inicie sesión nuevamente.'));
    }
    // El sondeo del dashboard no prolonga una sesión inactiva.
    if (req.get('x-smtel-interactive') === '1')
      run('UPDATE sessions SET last_activity=? WHERE token_hash=?', now(), hash);
    req.user = publicUser(row);
    req.sessionHash = hash;
    next();
  });
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', (req, res) => {
    run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash!);
    res.clearCookie('smtel_session', { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/dashboard', (req, res) => {
    if (!dashboardSnapshot || dashboardSnapshot.until < Date.now()) {
      const equipment = equipmentList(),
        requests = requestList();
      const common = {
        equipment,
        alerts: alerts(equipment, requests),
        settings: settings(),
        serverTime: now(),
        demo,
        health: {
          lastIngestion:
            get<{ received_at: string }>(
              'SELECT received_at FROM receipts ORDER BY received_at DESC LIMIT 1',
            )?.received_at || null,
          accepted: get<{ value: number }>("SELECT value FROM counters WHERE name='accepted'")!
            .value,
          rejected: get<{ value: number }>("SELECT value FROM counters WHERE name='rejected'")!
            .value,
        },
      };
      dashboardSnapshot = {
        until: Date.now() + 1000,
        prefix: JSON.stringify(common).slice(0, -1),
        requests,
      };
    }
    const requests = dashboardSnapshot.requests;
    const notifications = all(
      'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50',
      req.user!.id,
    ).map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      createdAt: n.created_at,
      read: Boolean(n.read),
    }));
    res
      .type('application/json')
      .send(
        dashboardSnapshot.prefix +
          ',"requests":' +
          JSON.stringify(
            req.user!.role === 'ADMIN'
              ? requests
              : requests.filter((r) => r.requesterId === req.user!.id),
          ) +
          ',"notifications":' +
          JSON.stringify(notifications) +
          '}',
      );
  });
  app.post('/api/notifications/:id/read', (req, res) => {
    run('UPDATE notifications SET read=1 WHERE id=? AND user_id=?', param(req, 'id'), req.user!.id);
    res.json({ ok: true });
  });
  app.get('/api/equipment/:id', (req, res) => {
    const equipment = equipmentById(param(req, 'id'));
    const range = z
      .object({
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
      })
      .parse(req.query);
    const from = range.from
      ? new Date(range.from).toISOString()
      : new Date(Date.now() - 86400000).toISOString();
    const to = range.to ? new Date(range.to).toISOString() : now();
    const metrics = all(
      'SELECT * FROM metrics WHERE equipment_id=? AND observed_at BETWEEN ? AND ? ORDER BY observed_at DESC LIMIT 2000',
      equipment.id,
      from,
      to,
    )
      .reverse()
      .map(metric);
    const history = auditRows(equipment.id).filter((row) =>
      ['BOOT_CHANGED', 'EQUIPMENT_CREATED', 'LOCATION_CHANGED', 'STATE_APPROVED'].includes(
        row.action,
      ),
    );
    res.json({
      equipment,
      metrics,
      history,
      requests: requestList().filter(
        (r) =>
          r.equipmentId === equipment.id &&
          (req.user!.role === 'ADMIN' || r.requesterId === req.user!.id),
      ),
      truncated: metrics.length === 2000,
    });
  });
  app.post('/api/equipment', authorize('ADMIN'), (req, res) => {
    const input = z
      .object({
        label: z.string().trim().min(3).max(200),
        assetTag: z.string().trim().min(2).max(100),
        location: locationSchema,
      })
      .strict()
      .parse(req.body);
    const id = randomUUID();
    transaction(() => {
      if (get('SELECT id FROM equipment WHERE asset_tag=?', input.assetTag))
        fail(409, 'La etiqueta de activo ya existe.');
      run(
        'INSERT INTO equipment(id,asset_tag,label,state,location,created_at) VALUES (?,?,?,?,?,?)',
        id,
        input.assetTag,
        input.label,
        'OPERATIVO',
        JSON.stringify(input.location),
        now(),
      );
      audit(req.user!, 'EQUIPMENT_CREATED', id, input);
    });
    res.status(201).json(equipmentById(id));
  });
  app.patch('/api/equipment/:id/location', authorize('ADMIN', 'SUPPORT'), (req, res) => {
    if (req.user!.role === 'SUPPORT' && !settings().supportCanLocate)
      fail(403, 'Soporte no tiene permiso para modificar ubicaciones.');
    const location = locationSchema.parse(req.body),
      id = param(req, 'id');
    transaction(() => {
      const before = equipmentById(id);
      if (before.archived) fail(409, 'El equipo está dado de baja.');
      run('UPDATE equipment SET location=? WHERE id=?', JSON.stringify(location), id);
      audit(req.user!, 'LOCATION_CHANGED', id, { from: before.location, to: location });
    });
    res.json(equipmentById(id));
  });
  app.post('/api/equipment/:id/archive', authorize('ADMIN'), (req, res) => {
    const id = param(req, 'id');
    transaction(() => {
      const equipment = equipmentById(id);
      if (equipment.state !== 'FUERA_SERVICIO' || equipment.pendingRequest)
        fail(
          409,
          'Apruebe primero Fuera de servicio y resuelva las solicitudes pendientes antes de dar de baja.',
        );
      run('UPDATE equipment SET archived=1 WHERE id=?', id);
      run('UPDATE agents SET revoked=1 WHERE equipment_id=?', id);
      audit(req.user!, 'EQUIPMENT_ARCHIVED', id, {});
    });
    res.json({ ok: true });
  });
  app.post('/api/requests', (req, res) =>
    res.status(201).json(createRequest(req.user!, requestSchema.parse(req.body))),
  );
  app.post('/api/requests/:id/resolve', (req, res) => {
    const input = z
      .object({
        decision: z.enum(['APPROVED', 'REJECTED', 'CANCELLED']),
        comment: z.string().trim().max(2000).default(''),
      })
      .strict()
      .parse(req.body);
    res.json(resolveRequest(req.user!, param(req, 'id'), input.decision, input.comment));
  });
  app.get('/api/settings', authorize('ADMIN'), (_req, res) => res.json(settings()));
  app.put('/api/settings', authorize('ADMIN'), (req, res) => {
    const value = settingsSchema.parse(req.body);
    transaction(() => {
      const before = settings();
      run('UPDATE settings SET value=? WHERE id=1', JSON.stringify(value));
      audit(req.user!, 'SETTINGS_CHANGED', null, { from: before, to: value });
    });
    res.json(value);
  });
  app.get('/api/users', authorize('ADMIN'), (_req, res) =>
    res.json(all('SELECT * FROM users ORDER BY name').map(publicUser)),
  );
  app.post('/api/users', authorize('ADMIN'), (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(200),
        email: z.email().max(200),
        password: z.string().min(12).max(200),
        role: z.enum(['ADMIN', 'MEMBER', 'SUPPORT']),
      })
      .strict()
      .parse(req.body);
    const id = randomUUID(),
      secret = input.role === 'ADMIN' ? createTotpSecret() : null;
    transaction(() => {
      if (get('SELECT id FROM users WHERE email=?', input.email.toLowerCase()))
        fail(409, 'Este correo ya está registrado.');
      run(
        'INSERT INTO users(id,name,email,password_hash,role,totp_secret) VALUES (?,?,?,?,?,?)',
        id,
        input.name,
        input.email.toLowerCase(),
        hashPassword(input.password),
        input.role,
        secret,
      );
      audit(req.user!, 'USER_CREATED', null, { userId: id, name: input.name, role: input.role });
    });
    res.status(201).json({
      user: publicUser(get('SELECT * FROM users WHERE id=?', id)!),
      ...(secret
        ? {
            mfaSecret: secret,
            mfaUri: `otpauth://totp/SMTEL:${encodeURIComponent(input.email)}?secret=${secret}&issuer=SMTEL`,
          }
        : {}),
    });
  });
  app.patch('/api/users/:id', authorize('ADMIN'), (req, res) => {
    const input = z
        .object({ role: z.enum(['ADMIN', 'MEMBER', 'SUPPORT']), active: z.boolean() })
        .strict()
        .parse(req.body),
      id = param(req, 'id');
    let secret: string | null = null;
    transaction(() => {
      const before =
        get('SELECT * FROM users WHERE id=?', id) || fail(404, 'Usuario no encontrado.');
      if (
        before.role === 'ADMIN' &&
        (!input.active || input.role !== 'ADMIN') &&
        all("SELECT id FROM users WHERE role='ADMIN' AND active=1").length <= 1
      )
        fail(409, 'Debe conservar al menos un administrador activo.');
      if (id === req.user!.id && (!input.active || input.role !== 'ADMIN'))
        fail(409, 'No puede retirar su propio acceso de administrador.');
      if (input.role === 'ADMIN' && before.role !== 'ADMIN') secret = createTotpSecret();
      run(
        'UPDATE users SET role=?,active=?,totp_secret=COALESCE(?,totp_secret) WHERE id=?',
        input.role,
        Number(input.active),
        secret,
        id,
      );
      run('DELETE FROM sessions WHERE user_id=?', id);
      audit(req.user!, 'USER_ACCESS_CHANGED', null, {
        userId: id,
        from: { role: before.role, active: Boolean(before.active) },
        to: input,
      });
    });
    res.json({
      user: publicUser(get('SELECT * FROM users WHERE id=?', id)!),
      ...(secret ? { mfaSecret: secret } : {}),
    });
  });
  app.get('/api/agents', authorize('ADMIN'), (_req, res) =>
    res.json(
      all(
        'SELECT a.id,a.equipment_id AS equipmentId,a.os_id AS osId,a.revoked,a.created_at AS createdAt,e.asset_tag AS assetTag FROM agents a JOIN equipment e ON e.id=a.equipment_id ORDER BY a.created_at DESC',
      ).map((a) => ({ ...a, revoked: Boolean(a.revoked) })),
    ),
  );
  app.post('/api/agents', authorize('ADMIN'), (req, res) => {
    const input = z
      .object({ equipmentId: z.string().min(1).max(200), osId: z.string().trim().min(1).max(200) })
      .strict()
      .parse(req.body);
    const token = newSecret(),
      hmacSecret = newSecret(),
      id = randomUUID();
    transaction(() => {
      const equipment = equipmentById(input.equipmentId);
      if (equipment.archived || equipment.demo)
        fail(409, 'Enrole agentes en equipos reales activos. Cree un equipo nuevo.');
      run(
        'INSERT INTO agents VALUES (?,?,?,?,?,0,?)',
        id,
        equipment.id,
        input.osId,
        sha256(token),
        hmacSecret,
        now(),
      );
      audit(req.user!, 'AGENT_ENROLLED', equipment.id, { agentId: id, osId: input.osId });
    });
    res.status(201).json({
      agentId: id,
      equipmentId: input.equipmentId,
      osId: input.osId,
      token,
      hmacSecret,
      serverUrl: production ? origin : 'http://127.0.0.1:4000',
      interval: settings().reportingInterval,
      storageInterval: settings().storageInterval,
    });
  });
  app.post('/api/agents/:id/revoke', authorize('ADMIN'), (req, res) => {
    const id = param(req, 'id');
    transaction(() => {
      const agent =
        get('SELECT * FROM agents WHERE id=?', id) || fail(404, 'Agente no encontrado.');
      run('UPDATE agents SET revoked=1 WHERE id=?', id);
      audit(req.user!, 'AGENT_REVOKED', String(agent.equipment_id), { agentId: id });
    });
    res.json({ ok: true });
  });
  app.get('/api/audit', authorize('ADMIN'), (_req, res) =>
    res.json({ events: auditRows(), valid: verifyAudit() }),
  );
  app.get('/api/health', authorize('ADMIN'), (_req, res) => {
    const last =
      get<{ received_at: string }>(
        'SELECT received_at FROM receipts ORDER BY received_at DESC LIMIT 1',
      )?.received_at || null;
    res.json({
      database: Boolean(get('SELECT 1')),
      auditValid: verifyAudit(),
      lastIngestion: last,
      ingestionStale: !last || Date.now() - Date.parse(last) > 300000,
      demo,
    });
  });
  app.get('/api/reports/:format', (req, res) => {
    const query = z
      .object({
        type: z.enum(['inventory', 'states', 'locations', 'usage']).default('inventory'),
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
      })
      .parse(req.query);
    const from = query.from
        ? new Date(query.from).toISOString()
        : new Date(Date.now() - 7 * 86400000).toISOString(),
      to = query.to ? new Date(query.to).toISOString() : now();
    if (from > to) fail(422, 'El inicio del periodo debe ser anterior al final.');
    const equipment = equipmentList(true);
    let headings: string[], rows: (string | number)[][];
    if (query.type === 'inventory') {
      headings = [
        'Activo',
        'Equipo',
        'Estado',
        'Laboratorio',
        'Contenedor',
        'Posición',
        'Arranque',
        'SO activo',
        'CPU',
        'Arquitectura',
        'RAM GiB',
        'Último reporte UTC',
        'Demostración',
      ];
      rows = equipment.map((e) => [
        e.assetTag,
        e.label,
        STATE_LABELS[e.state],
        e.location.lab,
        e.location.container,
        e.location.position,
        e.inventory?.bootType || 'UNKNOWN',
        e.inventory?.operatingSystems.find((os) => os.active)?.name || 'Sin reporte',
        e.inventory?.cpuModel || '',
        e.inventory?.architecture || '',
        ((e.inventory?.ramTotalBytes || 0) / 2 ** 30).toFixed(1),
        e.lastSeen || '',
        e.demo ? 'Sí' : 'No',
      ]);
    } else if (query.type === 'usage') {
      headings = [
        'Activo',
        'SO origen',
        'Mediciones',
        'CPU promedio %',
        'CPU máximo %',
        'RAM promedio %',
        'Disco máximo %',
        'Desde UTC',
        'Hasta UTC',
      ];
      rows = all(
        'SELECT e.asset_tag,m.os_id,COUNT(*) AS count,AVG(m.cpu) AS avg_cpu,MAX(m.cpu) AS max_cpu,AVG(m.ram) AS avg_ram,MAX(m.disk) AS max_disk,MIN(m.observed_at) AS first_at,MAX(m.observed_at) AS last_at FROM metrics m JOIN equipment e ON e.id=m.equipment_id WHERE m.observed_at BETWEEN ? AND ? GROUP BY m.equipment_id,m.os_id',
        from,
        to,
      ).map((r) => [
        String(r.asset_tag),
        String(r.os_id),
        Number(r.count),
        Number(r.avg_cpu).toFixed(1),
        Number(r.max_cpu).toFixed(1),
        Number(r.avg_ram).toFixed(1),
        Number(r.max_disk).toFixed(1),
        String(r.first_at),
        String(r.last_at),
      ]);
    } else {
      headings = ['Fecha UTC', 'Activo', 'Responsable', 'Evento', 'Detalle'];
      rows = all(
        'SELECT a.*,e.asset_tag FROM audit a LEFT JOIN equipment e ON e.id=a.equipment_id WHERE a.action=? AND a.created_at BETWEEN ? AND ? ORDER BY a.created_at',
        query.type === 'states' ? 'STATE_APPROVED' : 'LOCATION_CHANGED',
        from,
        to,
      ).map((r) => [
        String(r.created_at),
        String(r.asset_tag || ''),
        String(r.actor_name),
        String(r.action),
        String(r.detail),
      ]);
    }
    const format = param(req, 'format'),
      filename = `smtel-${query.type}-${now().slice(0, 10)}`;
    if (format === 'csv') {
      const escape = (value: string | number) => {
        let cell = String(value);
        if (/^[=+@\-\t\r]/.test(cell)) cell = `'${cell}`;
        return `"${cell.replaceAll('"', '""')}"`;
      };
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.type('text/csv; charset=utf-8');
      res.send('\uFEFF' + [headings, ...rows].map((row) => row.map(escape).join(',')).join('\r\n'));
    } else if (format === 'pdf') {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      res.type('application/pdf');
      const pdf = new PDFDocument({ size: 'A4', margin: 45, bufferPages: true });
      pdf.pipe(res);
      pdf.fontSize(24).fillColor('#164e42').text('SMTEL');
      pdf
        .fontSize(14)
        .text(
          `Reporte · ${query.type === 'inventory' ? 'Inventario' : query.type === 'usage' ? 'Uso de recursos' : query.type === 'states' ? 'Historial de estados' : 'Historial de ubicaciones'}`,
        );
      pdf
        .moveDown()
        .fontSize(9)
        .fillColor('#555555')
        .text(
          `Generado: ${now()} | ${rows.length} registros${demo ? ' | Incluye datos de demostración' : ''}`,
        )
        .text(`Periodo: ${from} a ${to}`)
        .moveDown();
      for (const row of rows) {
        const entries = headings.map((heading, i) => `${heading}: ${String(row[i])}`).join('\n');
        const height = pdf.fontSize(9).heightOfString(entries, { width: 500 }) + 25;
        if (pdf.y + height > 775) pdf.addPage();
        pdf.fillColor('#222222').text(entries, { width: 500 }).moveDown();
        pdf.strokeColor('#dddddd').moveTo(45, pdf.y).lineTo(550, pdf.y).stroke();
        pdf.moveDown();
      }
      if (!rows.length) pdf.text('No hay registros para el periodo seleccionado.');
      const pages = pdf.bufferedPageRange();
      for (let page = 0; page < pages.count; page++) {
        pdf.switchToPage(page);
        pdf
          .fontSize(8)
          .fillColor('#777777')
          .text(`SMTEL · ${page + 1} / ${pages.count}`, 45, 805, { lineBreak: false });
      }
      pdf.end();
    } else fail(404, 'Formato de reporte no disponible.');
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.')));
  const webPath = resolve(root, 'apps/web/dist');
  if (existsSync(webPath)) {
    app.use(express.static(webPath));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(webPath, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError)
      res.status(422).json({
        error: 'Datos no válidos.',
        details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    else if (error instanceof HttpError) res.status(error.status).json({ error: error.message });
    else if (error instanceof SyntaxError) res.status(400).json({ error: 'JSON no válido.' });
    else {
      console.error(error);
      res.status(500).json({ error: 'No fue posible completar la operación.' });
    }
  });
  return app;
}
