import { randomUUID } from 'node:crypto';
import { all, get, run, transaction, audit, settings, notify, notifyAdmins, now } from './db.js';
import { sha256 } from './security.js';
import type {
  Alert,
  ChangeRequest,
  Equipment,
  Inventory,
  Metric,
  User,
} from '../../../packages/shared/src/index.js';
import type { z } from 'zod';
import type { reportSchema } from './schemas.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
export function metric(row: Record<string, unknown>): Metric {
  return {
    id: String(row.id),
    equipmentId: String(row.equipment_id),
    osId: String(row.os_id),
    observedAt: String(row.observed_at),
    receivedAt: String(row.received_at),
    cpuPercent: Number(row.cpu),
    ramPercent: Number(row.ram),
    ramUsedBytes: Number(row.ram_used),
    ramAvailableBytes: Number(row.ram_available),
    swapUsedBytes: Number(row.swap_used),
    diskPercent: Number(row.disk),
    networkSentBps: Number(row.net_sent),
    networkReceivedBps: Number(row.net_received),
    clockSkew: Boolean(row.clock_skew),
    delayed: Boolean(row.delayed),
  };
}
export function equipmentList(includeArchived = false): Equipment[] {
  const config = settings();
  const rows = all(
    `SELECT e.*,r.id AS pending_request FROM equipment e LEFT JOIN requests r ON r.equipment_id=e.id AND r.status='PENDING' ${includeArchived ? '' : 'WHERE e.archived=0'} ORDER BY e.asset_tag`,
  );
  const latestMetrics = new Map(
    all(
      'SELECT m.* FROM equipment e JOIN metrics m ON m.id=COALESCE((SELECT m2.id FROM metrics m2 WHERE m2.equipment_id=e.id AND m2.clock_skew=0 AND m2.observed_at<=? ORDER BY m2.observed_at DESC LIMIT 1),(SELECT m3.id FROM metrics m3 WHERE m3.equipment_id=e.id ORDER BY m3.received_at DESC,m3.rowid DESC LIMIT 1))',
      new Date(Date.now() + 60000).toISOString(),
    ).map((m) => [String(m.equipment_id), m]),
  );
  const lastReceived = new Map(
    all(
      'SELECT m.equipment_id,m.clock_skew FROM equipment e JOIN metrics m ON m.id=(SELECT m2.id FROM metrics m2 WHERE m2.equipment_id=e.id ORDER BY m2.received_at DESC,m2.rowid DESC LIMIT 1)',
    ).map((m) => [String(m.equipment_id), Boolean(m.clock_skew)]),
  );
  const reports = all<{ equipment_id: string; os_id: string; last_seen: string }>(
    'SELECT equipment_id,os_id,last_seen FROM os_reports',
  );
  const agents = all<{ equipment_id: string; os_id: string }>(
    'SELECT DISTINCT equipment_id,os_id FROM agents WHERE revoked=0',
  );
  return rows.map((r) => {
    const latest = latestMetrics.get(String(r.id));
    const inventory: Inventory | null = r.inventory ? JSON.parse(String(r.inventory)) : null;
    if (inventory) {
      if (!r.demo)
        inventory.operatingSystems = inventory.operatingSystems.map((os) => ({
          ...os,
          agentInstalled: agents.some(
            (agent) => agent.equipment_id === r.id && agent.os_id === os.id,
          ),
          lastSeen:
            reports.find((report) => report.equipment_id === r.id && report.os_id === os.id)
              ?.last_seen || null,
        }));
    }
    return {
      id: String(r.id),
      assetTag: String(r.asset_tag),
      label: String(r.label),
      state: r.state as Equipment['state'],
      archived: Boolean(r.archived),
      demo: Boolean(r.demo),
      location: JSON.parse(String(r.location)),
      inventory,
      lastSeen: r.last_seen as string | null,
      online:
        !r.archived &&
        Boolean(r.last_seen) &&
        Date.now() - Date.parse(String(r.last_seen)) <
          config.offlineIntervals * Number(r.reporting_interval) * 1000,
      pendingRequest: r.pending_request as string | null,
      latestMetric: latest ? metric(latest) : null,
      clockSkewDetected: lastReceived.get(String(r.id)) || false,
      reportingInterval: Number(r.reporting_interval),
    };
  });
}
export function equipmentById(id: string): Equipment {
  return equipmentList(true).find((e) => e.id === id) || fail(404, 'Equipo no encontrado.');
}
export function requestList(): ChangeRequest[] {
  return all(
    `SELECT r.*,e.label AS equipment_label,e.asset_tag,u.name AS requester_name,v.name AS reviewer_name FROM requests r JOIN equipment e ON e.id=r.equipment_id JOIN users u ON u.id=r.requester_id LEFT JOIN users v ON v.id=r.reviewer_id ORDER BY r.created_at DESC LIMIT 1000`,
  ).map((r) => ({
    id: String(r.id),
    equipmentId: String(r.equipment_id),
    equipmentLabel: String(r.equipment_label),
    assetTag: String(r.asset_tag),
    fromState: r.from_state as ChangeRequest['fromState'],
    toState: r.to_state as ChangeRequest['toState'],
    justification: String(r.justification),
    status: r.status as ChangeRequest['status'],
    requesterId: String(r.requester_id),
    requesterName: String(r.requester_name),
    createdAt: String(r.created_at),
    reviewerId: r.reviewer_id as string | null,
    reviewerName: r.reviewer_name as string | null,
    reviewedAt: r.reviewed_at as string | null,
    comment: r.comment as string | null,
  }));
}
export function alerts(equipment: Equipment[], requests: ChangeRequest[]): Alert[] {
  const config = settings(),
    result: Alert[] = [];
  for (const e of equipment) {
    const add = (kind: Alert['kind'], message: string, severity: Alert['severity'] = 'warning') =>
      result.push({
        id: `${e.id}-${kind}`,
        equipmentId: e.id,
        equipmentLabel: e.label,
        kind,
        severity,
        message,
        at: e.lastSeen || now(),
      });
    if (!e.online)
      add(
        'OFFLINE',
        e.lastSeen
          ? 'Sin latidos del equipo. Últimos datos conservados.'
          : 'Equipo pendiente de su primer reporte.',
        'critical',
      );
    if (e.inventory?.bootType === 'UNKNOWN')
      add('BOOT', e.inventory.bootReason || 'Configuración de arranque por verificar.');
    if (e.online && e.latestMetric && !e.latestMetric.clockSkew) {
      if (e.latestMetric.cpuPercent >= config.cpuThreshold)
        add(
          'CPU',
          `Uso de CPU ${e.latestMetric.cpuPercent.toFixed(1)} %; umbral ${config.cpuThreshold} %.`,
          'critical',
        );
      if (e.latestMetric.ramPercent >= config.ramThreshold)
        add('RAM', `Memoria en uso ${e.latestMetric.ramPercent.toFixed(1)} %.`);
      if (e.latestMetric.diskPercent >= config.diskThreshold)
        add('DISK', `Almacenamiento en uso ${e.latestMetric.diskPercent.toFixed(1)} %.`);
    }
    if (e.clockSkewDetected || e.latestMetric?.clockSkew)
      add('CLOCK', 'Desvío horario superior a 60 segundos. Verifique NTP.');
    const pending = requests.find((r) => r.equipmentId === e.id && r.status === 'PENDING');
    if (pending && Date.now() - Date.parse(pending.createdAt) > config.pendingAlertHours * 3600000)
      add('PENDING', `Solicitud pendiente por más de ${config.pendingAlertHours} horas.`);
  }
  return result;
}
export function createRequest(
  user: User,
  input: { equipmentId: string; toState: Equipment['state']; justification: string },
): ChangeRequest {
  return transaction(() => {
    const equipment = equipmentById(input.equipmentId);
    if (equipment.archived) fail(409, 'El equipo está dado de baja.');
    if (!settings().transitions[equipment.state].includes(input.toState))
      fail(422, 'La transición solicitada no está permitida.');
    if (equipment.pendingRequest) fail(409, 'Ya existe una solicitud pendiente para este equipo.');
    const id = randomUUID();
    run(
      'INSERT INTO requests(id,equipment_id,from_state,to_state,justification,status,requester_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
      id,
      equipment.id,
      equipment.state,
      input.toState,
      input.justification,
      'PENDING',
      user.id,
      now(),
    );
    audit(user, 'STATE_REQUESTED', equipment.id, {
      requestId: id,
      from: equipment.state,
      to: input.toState,
      justification: input.justification,
    });
    notifyAdmins(
      'Cambio de estado pendiente',
      `${user.name} solicita un cambio para ${equipment.assetTag}.`,
    );
    return requestList().find((r) => r.id === id)!;
  });
}
export function resolveRequest(
  user: User,
  id: string,
  decision: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  comment: string,
): ChangeRequest {
  return transaction(() => {
    const request = requestList().find((r) => r.id === id) || fail(404, 'Solicitud no encontrada.');
    if (request.status !== 'PENDING') fail(409, 'La solicitud ya fue resuelta.');
    if (decision === 'CANCELLED') {
      if (request.requesterId !== user.id) fail(403, 'Solo el solicitante puede cancelar.');
    } else {
      if (user.role !== 'ADMIN') fail(403, 'Se requiere rol Administrador.');
      if (!settings().allowSelfApproval && user.id === request.requesterId)
        fail(403, 'La configuración exige un aprobador distinto del solicitante.');
      if (decision === 'REJECTED' && !comment.trim())
        fail(422, 'El motivo de rechazo es obligatorio.');
    }
    const equipment = equipmentById(request.equipmentId);
    if (decision === 'APPROVED') {
      if (
        equipment.archived ||
        equipment.state !== request.fromState ||
        !settings().transitions[equipment.state].includes(request.toState)
      )
        fail(409, 'El estado o la matriz de transiciones cambió; cancele o rechace la solicitud.');
      run('UPDATE equipment SET state=? WHERE id=?', request.toState, equipment.id);
    }
    run(
      "UPDATE requests SET status=?,reviewer_id=?,reviewed_at=?,comment=? WHERE id=? AND status='PENDING'",
      decision,
      user.id,
      now(),
      comment.trim() || null,
      id,
    );
    audit(user, `STATE_${decision}`, equipment.id, {
      requestId: id,
      from: request.fromState,
      to: request.toState,
      requesterId: request.requesterId,
      reviewerId: user.id,
      comment,
    });
    notify(
      request.requesterId,
      decision === 'APPROVED'
        ? 'Solicitud aprobada'
        : decision === 'REJECTED'
          ? 'Solicitud rechazada'
          : 'Solicitud cancelada',
      `${equipment.assetTag}: ${comment || decision}.`,
    );
    return requestList().find((r) => r.id === id)!;
  });
}
export function ingest(
  agent: Record<string, unknown>,
  report: z.infer<typeof reportSchema>,
  raw: Buffer,
  sentAt: string,
): { duplicate: boolean } {
  return transaction(() => {
    if (report.equipmentId !== agent.equipment_id || report.osId !== agent.os_id)
      fail(403, 'El reporte no corresponde al equipo y SO enrolados.');
    const receipt = get<{ payload_hash: string; agent_id: string }>(
      'SELECT payload_hash,agent_id FROM receipts WHERE id=?',
      report.id,
    );
    if (receipt) {
      if (receipt.payload_hash !== sha256(raw) || receipt.agent_id !== agent.id)
        fail(409, 'El identificador ya existe con otro contenido.');
      return { duplicate: true };
    }
    const equipment =
      get('SELECT * FROM equipment WHERE id=?', report.equipmentId) ||
      fail(404, 'Equipo no encontrado.');
    if (equipment.archived) fail(403, 'Equipo dado de baja.');
    const observedAt = new Date(report.observedAt).toISOString();
    const receivedAt = now(),
      skew = Date.now() - Date.parse(observedAt);
    const delayed = skew > 60000,
      clockSkew = skew < -60000 || Math.abs(Date.now() - Date.parse(sentAt)) > 60000;
    if (report.inventory) {
      const active = report.inventory.operatingSystems.find((os) => os.active)!;
      if (active.id !== report.osId)
        fail(422, 'El SO activo no coincide con el origen del reporte.');
      const family = (name: string) =>
        ['windows', 'ubuntu', 'debian', 'fedora', 'arch', 'opensuse'].find((token) =>
          name.toLowerCase().includes(token),
        ) || name.toLowerCase();
      const knownSystems = all<{ os_id: string; name: string }>(
        'SELECT os_id,name FROM os_reports WHERE equipment_id=?',
        report.equipmentId,
      );
      report.inventory.operatingSystems = report.inventory.operatingSystems.map((os) => {
        const matches = knownSystems.filter((known) => family(known.name) === family(os.name));
        const sameFamily = report.inventory!.operatingSystems.filter(
          (item) => family(item.name) === family(os.name),
        );
        if (
          !os.active &&
          os.inferred &&
          sameFamily.length === 1 &&
          matches.length === 1 &&
          matches[0].os_id !== report.osId
        )
          return { ...os, id: matches[0].os_id };
        return os;
      });
      const prior: Inventory | null = equipment.inventory
        ? JSON.parse(String(equipment.inventory))
        : null;
      const previousTime = prior ? Date.parse(prior.bootVerifiedAt) : 0;
      if (Date.parse(report.inventory.bootVerifiedAt) > Date.parse(observedAt) + 60000)
        fail(422, 'La verificación de arranque no puede ser posterior a la medición.');
      if (!clockSkew && Date.parse(report.inventory.bootVerifiedAt) >= previousTime) {
        const oldActive = prior?.operatingSystems.find((os) => os.active)?.id;
        const oldBoot = prior
          ? JSON.stringify([
              prior.bootType,
              prior.operatingSystems.map((os) => [os.id, os.partition]).sort(),
            ])
          : '';
        const newBoot = JSON.stringify([
          report.inventory.bootType,
          report.inventory.operatingSystems.map((os) => [os.id, os.partition]).sort(),
        ]);
        if (oldActive !== active.id || oldBoot !== newBoot)
          audit(null, 'BOOT_CHANGED', report.equipmentId, {
            fromOS: oldActive || null,
            toOS: active.id,
            bootType: report.inventory.bootType,
            observedAt,
            operatingSystems: report.inventory.operatingSystems.map((os) => ({
              id: os.id,
              name: os.name,
              partition: os.partition,
            })),
          });
        run(
          'UPDATE equipment SET inventory=? WHERE id=?',
          JSON.stringify(report.inventory),
          report.equipmentId,
        );
      }
      run(
        'INSERT INTO os_reports(equipment_id,os_id,name,last_seen,agent_id) VALUES (?,?,?,?,?) ON CONFLICT(equipment_id,os_id) DO UPDATE SET last_seen=MAX(last_seen,excluded.last_seen),name=excluded.name,agent_id=excluded.agent_id',
        report.equipmentId,
        report.osId,
        active.name,
        observedAt,
        String(agent.id),
      );
    } else if (!equipment.inventory) fail(422, 'El primer reporte debe incluir el inventario.');
    const m = report.metrics;
    run(
      'INSERT INTO metrics VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      report.id,
      report.equipmentId,
      report.osId,
      observedAt,
      receivedAt,
      m.cpuPercent,
      m.ramPercent,
      m.ramUsedBytes,
      m.ramAvailableBytes,
      m.swapUsedBytes,
      m.diskPercent,
      m.networkSentBps,
      m.networkReceivedBps,
      Number(clockSkew),
      Number(delayed),
    );
    run(
      'INSERT INTO receipts VALUES (?,?,?,?)',
      report.id,
      String(agent.id),
      sha256(raw),
      receivedAt,
    );
    if (!delayed && !clockSkew)
      run(
        'UPDATE equipment SET last_seen=?,reporting_interval=? WHERE id=?',
        receivedAt,
        settings().reportingInterval,
        report.equipmentId,
      );
    run(
      'UPDATE os_reports SET last_seen=MAX(last_seen,?) WHERE equipment_id=? AND os_id=?',
      observedAt,
      report.equipmentId,
      report.osId,
    );
    run("UPDATE counters SET value=value+1 WHERE name='accepted'");
    return { duplicate: false };
  });
}
export function simulateDemo(): void {
  transaction(() => {
    for (const equipment of equipmentList().filter(
      (e) => e.demo && e.id !== 'demo-10' && e.id !== 'demo-12',
    )) {
      const m = equipment.latestMetric!,
        ramTotal = equipment.inventory!.ramTotalBytes;
      const cpu = Math.max(0, Math.min(99, m.cpuPercent + Math.random() * 8 - 4)),
        ram = Math.max(0, Math.min(99, m.ramPercent + Math.random() * 2 - 1));
      const stamp = now();
      run(
        'INSERT INTO metrics VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        randomUUID(),
        equipment.id,
        m.osId,
        stamp,
        stamp,
        cpu,
        ram,
        Math.round((ramTotal * ram) / 100),
        Math.round(ramTotal * (1 - ram / 100)),
        m.swapUsedBytes,
        m.diskPercent,
        Math.round(Math.random() * 90000),
        Math.round(Math.random() * 200000),
        0,
        0,
      );
      run(
        'UPDATE equipment SET last_seen=?,reporting_interval=? WHERE id=?',
        stamp,
        settings().reportingInterval,
        equipment.id,
      );
    }
  });
}
