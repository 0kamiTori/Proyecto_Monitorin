import { z } from 'zod';
import { STATES } from '../../../packages/shared/src/index.js';
const text = z.string().trim().min(1).max(200);
const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const percent = z.number().min(0).max(100);
export const locationSchema = z
  .object({
    lab: text,
    container: text,
    position: text,
    x: z.number().min(0).max(1000).nullable(),
    y: z.number().min(0).max(1000).nullable(),
  })
  .strict();
export const inventorySchema = z
  .object({
    hostname: text,
    manufacturer: text,
    model: text,
    serial: text,
    cpuModel: text,
    physicalCores: z.number().int().min(1).max(4096),
    logicalCores: z.number().int().min(1).max(8192),
    frequencyMHz: z.number().min(0).max(20000),
    architecture: text,
    ramTotalBytes: bytes,
    firmware: z.enum(['UEFI', 'BIOS', 'UNKNOWN']),
    bootManager: text,
    bootType: z.enum(['SINGLE', 'MULTI', 'UNKNOWN']),
    bootReason: z.string().max(2000).nullable(),
    bootVerifiedAt: z.iso.datetime({ offset: true }),
    operatingSystems: z
      .array(
        z
          .object({
            id: text,
            name: text,
            version: text,
            architecture: text,
            partition: z.string().max(200),
            active: z.boolean(),
            inferred: z.boolean(),
            agentInstalled: z.boolean(),
            lastSeen: z.iso.datetime({ offset: true }).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    disks: z
      .array(z.object({ name: text, model: text, type: text, totalBytes: bytes }).strict())
      .max(128),
    partitions: z
      .array(
        z
          .object({
            disk: text,
            name: text,
            filesystem: text,
            mountpoint: z.string().max(500),
            totalBytes: bytes,
            usedBytes: bytes,
            os: z.string().max(200).nullable(),
          })
          .strict()
          .refine((p) => p.usedBytes <= p.totalBytes, 'El uso excede la capacidad'),
      )
      .max(256),
    adapters: z
      .array(
        z
          .object({
            name: text,
            mac: z.string().max(100),
            ipv4: z.array(z.string().max(100)).max(32),
            ipv6: z.array(z.string().max(100)).max(32),
            up: z.boolean(),
            speedMbps: z.number().nonnegative().max(1000000),
            bytesSent: bytes,
            bytesReceived: bytes,
          })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.operatingSystems.filter((os) => os.active).length !== 1)
      ctx.addIssue({
        code: 'custom',
        message: 'Debe existir exactamente un SO activo',
        path: ['operatingSystems'],
      });
    if (new Set(value.operatingSystems.map((os) => os.id)).size !== value.operatingSystems.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Identificadores de SO duplicados',
        path: ['operatingSystems'],
      });
    if (value.bootType === 'SINGLE' && value.operatingSystems.length !== 1)
      ctx.addIssue({
        code: 'custom',
        message: 'Single Boot requiere un solo SO',
        path: ['bootType'],
      });
    if (value.bootType === 'MULTI' && value.operatingSystems.length < 2)
      ctx.addIssue({
        code: 'custom',
        message: 'Multi Boot requiere al menos dos SO',
        path: ['bootType'],
      });
    if (value.bootType === 'UNKNOWN' && !value.bootReason?.trim())
      ctx.addIssue({
        code: 'custom',
        message: 'Indique la causa de detección indeterminada',
        path: ['bootReason'],
      });
  });
export const reportSchema = z
  .object({
    id: z.uuid(),
    equipmentId: text,
    osId: text,
    observedAt: z.iso.datetime({ offset: true }),
    inventory: inventorySchema.optional(),
    metrics: z
      .object({
        cpuPercent: percent,
        ramPercent: percent,
        ramUsedBytes: bytes,
        ramAvailableBytes: bytes,
        swapUsedBytes: bytes,
        diskPercent: percent,
        networkSentBps: bytes,
        networkReceivedBps: bytes,
      })
      .strict(),
  })
  .strict();
export const requestSchema = z
  .object({
    equipmentId: text,
    toState: z.enum(STATES),
    justification: z.string().trim().min(10).max(2000),
  })
  .strict();
export const settingsSchema = z
  .object({
    reportingInterval: z.number().int().min(10).max(3600),
    storageInterval: z.number().int().min(30).max(86400),
    offlineIntervals: z.number().int().min(2).max(20),
    cpuThreshold: percent.min(1),
    ramThreshold: percent.min(1),
    diskThreshold: percent.min(1),
    pendingAlertHours: z.number().min(0.01).max(720),
    supportCanLocate: z.boolean(),
    allowSelfApproval: z.boolean(),
    sessionIdleMinutes: z.number().int().min(5).max(120),
    metricRetentionDays: z.number().int().min(1).max(3650),
    transitions: z.object(
      Object.fromEntries(STATES.map((state) => [state, z.array(z.enum(STATES)).max(3)])) as Record<
        (typeof STATES)[number],
        z.ZodArray<z.ZodEnum<{ [K in (typeof STATES)[number]]: K }>>
      >,
    ),
  })
  .strict()
  .refine(
    (s) =>
      STATES.every(
        (state) =>
          !s.transitions[state].includes(state) &&
          new Set(s.transitions[state]).size === s.transitions[state].length,
      ),
    'No se permiten transiciones repetidas ni al mismo estado',
  );
