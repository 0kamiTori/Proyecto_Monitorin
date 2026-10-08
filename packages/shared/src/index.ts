export const STATES = ['OPERATIVO', 'MANTENIMIENTO', 'FUERA_SERVICIO', 'REASIGNADO'] as const;
export type EquipmentState = (typeof STATES)[number];
export type Role = 'ADMIN' | 'MEMBER' | 'SUPPORT';
export const STATE_LABELS: Record<EquipmentState, string> = {
  OPERATIVO: 'Operativo',
  MANTENIMIENTO: 'En mantenimiento',
  FUERA_SERVICIO: 'Fuera de servicio',
  REASIGNADO: 'Reasignado',
};
export const DEFAULT_TRANSITIONS: Record<EquipmentState, EquipmentState[]> = {
  OPERATIVO: ['MANTENIMIENTO', 'FUERA_SERVICIO', 'REASIGNADO'],
  MANTENIMIENTO: ['OPERATIVO', 'FUERA_SERVICIO'],
  FUERA_SERVICIO: ['OPERATIVO', 'MANTENIMIENTO'],
  REASIGNADO: ['OPERATIVO', 'MANTENIMIENTO'],
};
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}
export interface Location {
  lab: string;
  container: string;
  position: string;
  x: number | null;
  y: number | null;
}
export interface OSInstallation {
  id: string;
  name: string;
  version: string;
  architecture: string;
  partition: string;
  active: boolean;
  inferred: boolean;
  agentInstalled: boolean;
  lastSeen: string | null;
}
export interface Partition {
  disk: string;
  name: string;
  filesystem: string;
  mountpoint: string;
  totalBytes: number;
  usedBytes: number;
  os: string | null;
}
export interface Disk {
  name: string;
  model: string;
  type: string;
  totalBytes: number;
}
export interface NetworkAdapter {
  name: string;
  mac: string;
  ipv4: string[];
  ipv6: string[];
  up: boolean;
  speedMbps: number;
  bytesSent: number;
  bytesReceived: number;
}
export interface Inventory {
  hostname: string;
  manufacturer: string;
  model: string;
  serial: string;
  cpuModel: string;
  physicalCores: number;
  logicalCores: number;
  frequencyMHz: number;
  architecture: string;
  ramTotalBytes: number;
  firmware: 'UEFI' | 'BIOS' | 'UNKNOWN';
  bootManager: string;
  bootType: 'SINGLE' | 'MULTI' | 'UNKNOWN';
  bootReason: string | null;
  bootVerifiedAt: string;
  operatingSystems: OSInstallation[];
  disks: Disk[];
  partitions: Partition[];
  adapters: NetworkAdapter[];
}
export interface Metric {
  id: string;
  equipmentId: string;
  osId: string;
  observedAt: string;
  receivedAt: string;
  cpuPercent: number;
  ramPercent: number;
  ramUsedBytes: number;
  ramAvailableBytes: number;
  swapUsedBytes: number;
  diskPercent: number;
  networkSentBps: number;
  networkReceivedBps: number;
  clockSkew: boolean;
  delayed: boolean;
}
export interface Equipment {
  id: string;
  assetTag: string;
  label: string;
  state: EquipmentState;
  archived: boolean;
  demo: boolean;
  location: Location;
  inventory: Inventory | null;
  lastSeen: string | null;
  online: boolean;
  pendingRequest: string | null;
  latestMetric: Metric | null;
  clockSkewDetected: boolean;
  reportingInterval: number;
}
export interface ChangeRequest {
  id: string;
  equipmentId: string;
  equipmentLabel: string;
  assetTag: string;
  fromState: EquipmentState;
  toState: EquipmentState;
  justification: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requesterId: string;
  requesterName: string;
  createdAt: string;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  comment: string | null;
}
export interface Notification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}
export interface Settings {
  reportingInterval: number;
  storageInterval: number;
  offlineIntervals: number;
  cpuThreshold: number;
  ramThreshold: number;
  diskThreshold: number;
  pendingAlertHours: number;
  supportCanLocate: boolean;
  allowSelfApproval: boolean;
  sessionIdleMinutes: number;
  metricRetentionDays: number;
  transitions: Record<EquipmentState, EquipmentState[]>;
}
export interface Alert {
  id: string;
  equipmentId: string;
  equipmentLabel: string;
  kind: 'CPU' | 'RAM' | 'DISK' | 'OFFLINE' | 'BOOT' | 'PENDING' | 'CLOCK';
  severity: 'warning' | 'critical';
  message: string;
  at: string;
}
export interface Audit {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  equipmentId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  previousHash: string;
  hash: string;
}
export interface Dashboard {
  equipment: Equipment[];
  requests: ChangeRequest[];
  alerts: Alert[];
  settings: Settings;
  notifications: Notification[];
  serverTime: string;
  demo: boolean;
  health: { lastIngestion: string | null; accepted: number; rejected: number };
}
