import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  LayoutDashboard,
  Monitor,
  MapPin,
  ClipboardList,
  FileChartColumn,
  Settings2,
  LogOut,
  ArrowUpRight,
  ArrowLeft,
  Search,
  ChevronRight,
  Bell,
  Check,
  X,
  Plus,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  ShieldCheck,
  CircleHelp,
  Download,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  AlertTriangle,
  Server,
  CheckCircle2,
  LoaderCircle,
  Users,
  KeyRound,
  Fingerprint,
  SlidersHorizontal,
  CircleDot,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { api, post, mutate, ApiError, downloadJson, downloadReport } from './api';
import {
  STATES,
  STATE_LABELS,
  type User,
  type Equipment,
  type Dashboard,
  type Metric,
  type ChangeRequest,
  type Location,
  type Audit,
  type Settings,
} from '../../../packages/shared/src/index';

type Page = 'overview' | 'equipment' | 'map' | 'requests' | 'reports' | 'admin' | 'detail';
type DetailData = {
  equipment: Equipment;
  metrics: Metric[];
  history: Audit[];
  requests: ChangeRequest[];
  truncated: boolean;
};
type Dialog =
  | { kind: 'request'; equipment?: Equipment }
  | { kind: 'decision'; request: ChangeRequest; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED' }
  | { kind: 'location'; equipment: Equipment }
  | { kind: 'create' }
  | { kind: 'archive'; equipment: Equipment }
  | { kind: 'credentials'; title: string; value: unknown; filename: string };
const roleLabels = {
  ADMIN: 'Administrador',
  MEMBER: 'Miembro del laboratorio',
  SUPPORT: 'Soporte técnico',
};
const stateColors = {
  OPERATIVO: '#438776',
  MANTENIMIENTO: '#e9b25f',
  FUERA_SERVICIO: '#d67972',
  REASIGNADO: '#8998cc',
};
const formatDate = (value: string | null, short = false) =>
  value
    ? new Intl.DateTimeFormat('es-CO', {
        day: '2-digit',
        month: 'short',
        ...(short ? {} : { year: 'numeric' }),
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : 'Sin reporte';
const gb = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GiB`;
const activeOS = (equipment: Equipment) =>
  equipment.inventory?.operatingSystems.find((os) => os.active);
const bootLabel = (equipment: Equipment) =>
  equipment.inventory?.bootType === 'MULTI'
    ? 'Multi Boot'
    : equipment.inventory?.bootType === 'SINGLE'
      ? 'Single Boot'
      : 'Por verificar';
const statusLabel = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada',
};
function StateBadge({ state }: { state: Equipment['state'] }) {
  return (
    <span className={`badge state-${state}`}>
      <span className="status-dot" />
      {STATE_LABELS[state]}
    </span>
  );
}
function Meter({ value, threshold = 85 }: { value: number | undefined; threshold?: number }) {
  return (
    <span className="meter">
      <span className="meter-track">
        <span
          style={{
            width: `${value || 0}%`,
            background: (value || 0) >= threshold ? '#d7825d' : '#75a896',
          }}
        />
      </span>
      <span>{value === undefined ? '—' : `${Math.round(value)}%`}</span>
    </span>
  );
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Monitor size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Chart({
  metrics,
  mode = 'resources',
}: {
  metrics: Metric[];
  mode?: 'resources' | 'network';
}) {
  const rows = metrics.map((m) => ({
    time: new Date(m.observedAt).getTime(),
    osId: m.osId,
    cpu: Math.round(m.cpuPercent * 10) / 10,
    ram: Math.round(m.ramPercent * 10) / 10,
    disk: Math.round(m.diskPercent * 10) / 10,
    sent: Math.round(m.networkSentBps / 1024),
    received: Math.round(m.networkReceivedBps / 1024),
  }));
  if (!rows.length)
    return (
      <Empty title="Aún no hay mediciones">
        Las gráficas aparecerán cuando el agente envíe su primer reporte.
      </Empty>
    );
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 12, left: -20, bottom: 2 }}>
          <defs>
            <linearGradient id={`chartFill-${mode}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#438776" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#438776" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e9eeec" />
          <XAxis
            dataKey="time"
            tickFormatter={(time) =>
              new Date(time).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
            }
            axisLine={false}
            tickLine={false}
            minTickGap={55}
            tick={{ fill: '#8b9691', fontSize: 10 }}
          />
          <YAxis
            domain={mode === 'resources' ? [0, 100] : [0, 'auto']}
            tickFormatter={(value) => (mode === 'resources' ? `${value}%` : `${value}`)}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#8b9691', fontSize: 10 }}
          />
          <Tooltip
            labelFormatter={(time) => formatDate(new Date(Number(time)).toISOString())}
            formatter={(value, name) => [`${value} ${mode === 'resources' ? '%' : 'KiB/s'}`, name]}
            contentStyle={{ borderRadius: 12, border: '1px solid #e4ebe6', fontSize: 12 }}
          />
          {mode === 'resources' ? (
            <>
              <Area
                name="CPU"
                type="monotone"
                dataKey="cpu"
                stroke="#438776"
                fill={`url(#chartFill-${mode})`}
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                name="RAM"
                type="monotone"
                dataKey="ram"
                stroke="#c5a56d"
                fill="transparent"
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                name="Disco"
                type="monotone"
                dataKey="disk"
                stroke="#8998cc"
                fill="transparent"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                isAnimationActive={false}
              />
            </>
          ) : (
            <>
              <Area
                name="Recibido"
                type="monotone"
                dataKey="received"
                stroke="#438776"
                fill={`url(#chartFill-${mode})`}
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                name="Enviado"
                type="monotone"
                dataKey="sent"
                stroke="#c5a56d"
                fill="transparent"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </>
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [mfa, setMfa] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await post<{ user: User }>('/auth/login', {
        email,
        password,
        ...(code ? { totp: code } : {}),
      });
      onLogin(result.user);
    } catch (err) {
      if (err instanceof ApiError && err.mfaRequired) setMfa(true);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-art">
        <div className="brand">
          <span className="brand-mark">
            <Activity />
          </span>
          <span>
            SMTEL<span className="brand-sub">LABORATORIO CONECTADO</span>
          </span>
        </div>
        <div className="login-message">
          <span className="eyebrow">VISIBILIDAD PARA CADA EQUIPO</span>
          <h1>
            Todo tu laboratorio.
            <br />
            <em>Un mismo pulso.</em>
          </h1>
          <p>Conoce tus equipos, observa sus recursos y gestiona cada cambio con trazabilidad.</p>
          <div className="illustration">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="illustration-core">
              <Activity size={58} strokeWidth={1.4} />
            </div>
            {[Monitor, Cpu, HardDrive, Network].map((Icon, i) => (
              <span className={`illustration-node node-${i}`} key={i}>
                <Icon size={23} />
              </span>
            ))}
          </div>
        </div>
        <span className="login-footnote">Telemetría · Inventario · Control de estados</span>
      </div>
      <main className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow">BIENVENIDO A SMTEL</span>
          <h2>Ingresa a tu laboratorio</h2>
          <p className="muted">Accede con tu cuenta para consultar y gestionar los equipos.</p>
          <label>
            Correo electrónico
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@laboratorio.edu"
              required
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tu contraseña"
              required
            />
          </label>
          <label>
            Código de autenticación{' '}
            <span className="muted">{mfa ? '(requerido)' : '(administradores)'}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Código de 6 dígitos"
              required={mfa}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                Ingresar <ArrowUpRight size={18} />
              </>
            )}
          </button>
          <div className="login-security">
            <ShieldCheck size={15} /> Acceso protegido por roles. Administradores con MFA.
          </div>
          <details className="demo-login">
            <summary>Acceso al entorno de demostración</summary>
            <p>
              Disponible cuando el servidor inicia en modo demostración. Los equipos de muestra
              contienen datos sintéticos.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button small"
                onClick={() => {
                  setEmail('miembro@smtel.local');
                  setPassword('SMTEL.demo2026!');
                  setMfa(false);
                  setCode('');
                }}
              >
                Miembro
              </button>
              <button
                type="button"
                className="button small"
                onClick={() => {
                  setEmail('soporte@smtel.local');
                  setPassword('SMTEL.demo2026!');
                  setMfa(false);
                  setCode('');
                }}
              >
                Soporte
              </button>
            </div>
          </details>
        </form>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [data, setData] = useState<Dashboard | null>(null),
    [page, setPage] = useState<Page>('overview'),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(null),
    [notificationOpen, setNotificationOpen] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [refreshId, setRefreshId] = useState(0),
    [connectionError, setConnectionError] = useState(false);
  const activity = useRef(Date.now());
  const closeDialog = useCallback(() => setDialog(null), []);
  const tell = useCallback((message: string, error = false) => setToast({ message, error }), []);
  useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then((result) => setUser(result.user))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  const refresh = useCallback(
    async (interactive = true) => {
      try {
        const value = await api<Dashboard>('/dashboard', {}, interactive);
        setData(value);
        setConnectionError(false);
        setRefreshId((v) => v + 1);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setUser(null);
          setData(null);
        } else {
          setConnectionError(true);
          if (interactive) tell((err as Error).message, true);
        }
      }
    },
    [tell],
  );
  useEffect(() => {
    if (!user) return;
    void refresh();
    const interval = setInterval(() => void refresh(Date.now() - activity.current < 5000), 5000);
    return () => clearInterval(interval);
  }, [user, refresh]);
  useEffect(() => {
    const mark = () => {
      activity.current = Date.now();
    };
    window.addEventListener('pointerdown', mark);
    window.addEventListener('keydown', mark);
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), toast.error ? 9000 : 5000);
    return () => clearTimeout(timeout);
  }, [toast]);
  const navigate = (target: Page) => {
    setPage(target);
    setMobileNav(false);
    setNotificationOpen(false);
    window.scrollTo(0, 0);
  };
  const openEquipment = (id: string) => {
    setSelectedId(id);
    navigate('detail');
  };
  const perform = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation();
      tell(success);
      setDialog(null);
      await refresh();
      return true;
    } catch (err) {
      tell((err as Error).message, true);
      return false;
    }
  };
  if (checking)
    return (
      <div className="loading-page">
        <Activity className="pulse" size={40} />
        <p>Conectando con el laboratorio…</p>
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={(value) => {
          setPage('overview');
          setSelectedId(null);
          setDialog(null);
          setNotificationOpen(false);
          setUser(value);
        }}
      />
    );
  const pending = data?.requests.filter((r) => r.status === 'PENDING').length || 0;
  const unread = data?.notifications.filter((n) => !n.read).length || 0;
  const titles: Record<Page, string> = {
    overview: 'Resumen general',
    equipment: 'Equipos del laboratorio',
    map: 'Plano del laboratorio',
    requests: user.role === 'ADMIN' ? 'Cola de aprobaciones' : 'Mis solicitudes',
    reports: 'Reportes',
    admin: 'Administración',
    detail: 'Detalle del equipo',
  };
  const nav = [
    { page: 'overview' as Page, label: 'Resumen general', Icon: LayoutDashboard },
    { page: 'equipment' as Page, label: 'Equipos', Icon: Monitor },
    { page: 'map' as Page, label: 'Plano del laboratorio', Icon: MapPin },
    {
      page: 'requests' as Page,
      label: user.role === 'ADMIN' ? 'Aprobaciones' : 'Mis solicitudes',
      Icon: ClipboardList,
    },
    { page: 'reports' as Page, label: 'Reportes', Icon: FileChartColumn },
  ];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">
            <Activity size={24} />
          </span>
          <span>
            SMTEL<span className="brand-sub">LABORATORIO CONECTADO</span>
          </span>
        </div>
        <div className="workspace-card">
          <span className="workspace-icon">
            <Server size={18} />
          </span>
          <div>
            <strong>Lab. de desarrollo</strong>
            <small>Espacio de trabajo</small>
          </div>
          <span className="status-dot" />
        </div>
        <span className="nav-label">LABORATORIO</span>
        <nav>
          {nav.map((item) => (
            <button
              key={item.page}
              className={`nav-item ${page === item.page || (page === 'detail' && item.page === 'equipment') ? 'active' : ''}`}
              onClick={() => navigate(item.page)}
            >
              <item.Icon size={18} />
              <span>{item.label}</span>
              {item.page === 'requests' && pending > 0 && (
                <span className="nav-count">{pending}</span>
              )}
            </button>
          ))}
        </nav>
        {user.role === 'ADMIN' && (
          <>
            <span className="nav-label second">GESTIÓN</span>
            <button
              className={`nav-item ${page === 'admin' ? 'active' : ''}`}
              onClick={() => navigate('admin')}
            >
              <Settings2 size={18} />
              <span>Administración</span>
            </button>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="system-status">
            <span className={`status-dot ${connectionError ? 'offline' : ''}`} />
            <div>
              <strong>{connectionError ? 'Conexión interrumpida' : 'Sistema conectado'}</strong>
              <small>
                {data
                  ? `Actualizado ${new Date(data.serverTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                  : 'Conectando…'}
              </small>
            </div>
          </div>
          <div className="user-card">
            <span className="avatar">
              {user.name
                .split(' ')
                .slice(0, 2)
                .map((word) => word[0])
                .join('')}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{roleLabels[user.role]}</small>
            </div>
            <button
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="icon-button"
              onClick={() =>
                void perform(async () => {
                  await post('/auth/logout', {});
                  setUser(null);
                  setData(null);
                }, 'Sesión cerrada.')
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Cerrar menú"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Abrir menú"
              onClick={() => setMobileNav(true)}
            >
              <LayoutDashboard size={20} />
            </button>
            <span>Laboratorio</span>
            <ChevronRight size={13} />
            <strong>{titles[page]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="today">
              {new Date().toLocaleDateString('es-CO', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <span className="live-pill">
              <span className={`status-dot ${connectionError ? 'offline' : ''}`} />
              {connectionError ? 'Sin conexión' : 'En vivo'}
            </span>
            <div className="notifications-wrap">
              <button
                className={`icon-button notification-button ${unread ? 'has-notification' : ''}`}
                title="Notificaciones"
                aria-label="Notificaciones"
                onClick={() => setNotificationOpen(!notificationOpen)}
              >
                <Bell size={19} />
              </button>
              {notificationOpen && (
                <div className="notification-menu">
                  <div className="panel-title">
                    <h3>Notificaciones</h3>
                    <span>{unread} nuevas</span>
                  </div>
                  {!data?.notifications.length ? (
                    <p className="muted">No hay notificaciones.</p>
                  ) : (
                    data.notifications.map((n) => (
                      <button
                        key={n.id}
                        className={`notification-item ${n.read ? '' : 'unread'}`}
                        onClick={() => {
                          void post(`/notifications/${n.id}/read`, {}).then(() => refresh());
                          navigate('requests');
                        }}
                      >
                        <strong>{n.title}</strong>
                        <p>{n.body}</p>
                        <small>{formatDate(n.createdAt, true)}</small>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page-content">
          {connectionError && (
            <div className="connection-banner" role="alert">
              <WifiOff size={16} /> No se pudo actualizar. Se muestran los últimos datos recibidos.
              <button onClick={() => void refresh()}>Reintentar</button>
            </div>
          )}
          {data?.demo && (
            <div className="demo-banner">
              <CircleHelp size={14} />
              <span>
                Entorno de demostración. Los equipos etiquetados como muestra contienen telemetría
                sintética.
              </span>
            </div>
          )}
          {!data ? (
            <Empty title={connectionError ? 'No se pudo conectar' : 'Preparando el tablero'}>
              {connectionError ? (
                'Verifica que la API esté ejecutándose.'
              ) : (
                <LoaderCircle className="spin" />
              )}
            </Empty>
          ) : (
            <>
              {page === 'overview' && (
                <Overview
                  data={data}
                  navigate={navigate}
                  openEquipment={openEquipment}
                  onRequest={() => setDialog({ kind: 'request' })}
                />
              )}
              {page === 'equipment' && (
                <EquipmentPage
                  data={data}
                  user={user}
                  openEquipment={openEquipment}
                  onCreate={() => setDialog({ kind: 'create' })}
                />
              )}
              {page === 'map' && <MapPage data={data} openEquipment={openEquipment} />}
              {page === 'requests' && (
                <RequestsPage
                  data={data}
                  user={user}
                  onRequest={() => setDialog({ kind: 'request' })}
                  onDecision={(request, decision) =>
                    setDialog({ kind: 'decision', request, decision })
                  }
                  openEquipment={openEquipment}
                />
              )}
              {page === 'reports' && <ReportsPage tell={tell} />}
              {page === 'detail' && selectedId && (
                <DetailPage
                  id={selectedId}
                  data={data}
                  user={user}
                  refreshId={refreshId}
                  back={() => navigate('equipment')}
                  onRequest={(equipment) => setDialog({ kind: 'request', equipment })}
                  onLocation={(equipment) => setDialog({ kind: 'location', equipment })}
                  onArchive={(equipment) => setDialog({ kind: 'archive', equipment })}
                  tell={tell}
                />
              )}
              {page === 'admin' && user.role === 'ADMIN' && (
                <AdminPage
                  data={data}
                  refreshId={refreshId}
                  perform={perform}
                  onCredentials={(title, value, filename) =>
                    setDialog({ kind: 'credentials', title, value, filename })
                  }
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>SMTEL · Sistema de Monitoreo y Telemetría de Equipos de Laboratorio</span>
            <span>Hora local · Datos almacenados en UTC</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          <button className="icon-button" aria-label="Cerrar aviso" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {dialog && data && (
        <ActionDialog dialog={dialog} data={data} close={closeDialog} perform={perform} />
      )}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Overview({
  data,
  navigate,
  openEquipment,
  onRequest,
}: {
  data: Dashboard;
  navigate: (page: Page) => void;
  openEquipment: (id: string) => void;
  onRequest: () => void;
}) {
  const equipment = data.equipment,
    online = equipment.filter((e) => e.online).length,
    operative = equipment.filter((e) => e.state === 'OPERATIVO').length,
    pending = data.requests.filter((r) => r.status === 'PENDING').length;
  const [chartId, setChartId] = useState(equipment[0]?.id || ''),
    [metrics, setMetrics] = useState<Metric[]>([]);
  useEffect(() => {
    if (!chartId) return;
    let cancelled = false;
    api<DetailData>(`/equipment/${chartId}`, {}, false)
      .then((result) => {
        if (!cancelled) setMetrics(result.metrics);
      })
      .catch(() => {
        if (!cancelled) setMetrics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chartId, data.serverTime]);
  const stateData = STATES.map((state) => ({
    name: STATE_LABELS[state],
    value: equipment.filter((e) => e.state === state).length,
    color: stateColors[state],
  }));
  return (
    <>
      <PageHeading
        eyebrow="EL PULSO DE TU LABORATORIO"
        title="Todo bajo observación."
        description="Una visión clara de tus equipos, sus recursos y lo que requiere atención."
        action={
          <button className="button primary" onClick={onRequest}>
            <Plus size={17} /> Nueva solicitud
          </button>
        }
      />
      <div className="stats-grid">
        {[
          {
            label: 'Equipos registrados',
            value: equipment.length,
            note: 'Inventario del laboratorio',
            Icon: Monitor,
            color: 'green',
          },
          {
            label: 'Equipos en línea',
            value: online,
            note: `${equipment.length - online} sin conexión`,
            Icon: Wifi,
            color: 'mint',
          },
          {
            label: 'Equipos operativos',
            value: operative,
            note: `${equipment.length ? Math.round((operative / equipment.length) * 100) : 0}% del inventario`,
            Icon: CheckCircle2,
            color: 'blue',
          },
          {
            label: 'Solicitudes pendientes',
            value: pending,
            note: 'Requieren una decisión',
            Icon: ClipboardList,
            color: 'sand',
          },
        ].map((stat, i) => (
          <button
            className="stat-card"
            key={stat.label}
            onClick={() => navigate(i === 3 ? 'requests' : 'equipment')}
          >
            <div className="stat-top">
              <span>{stat.label}</span>
              <span className={`stat-icon ${stat.color}`}>
                <stat.Icon size={19} />
              </span>
            </div>
            <strong className="stat-value">{stat.value.toString().padStart(2, '0')}</strong>
            <div className="stat-bottom">
              <span>{stat.note}</span>
              <ArrowUpRight size={14} />
            </div>
          </button>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel activity-panel">
          <div className="panel-title">
            <div>
              <h2>Actividad de recursos</h2>
              <p>Últimas mediciones del equipo seleccionado</p>
            </div>
            <select
              aria-label="Equipo de la gráfica"
              value={chartId}
              onChange={(e) => {
                setMetrics([]);
                setChartId(e.target.value);
              }}
            >
              <option value="" disabled>
                Seleccionar equipo
              </option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.assetTag}
                  {e.demo ? ' · muestra' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="chart-legend">
            <span>
              <i style={{ background: '#438776' }} /> CPU
            </span>
            <span>
              <i style={{ background: '#c5a56d' }} /> RAM
            </span>
            <span>
              <i style={{ background: '#8998cc' }} /> Disco
            </span>
            <span className="legend-note">Uso en porcentaje</span>
          </div>
          <Chart metrics={metrics} />
        </section>
        <section className="panel state-panel">
          <div className="panel-title">
            <div>
              <h2>Estado del inventario</h2>
              <p>Distribución de los equipos</p>
            </div>
            <CircleDot size={18} className="muted" />
          </div>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stateData}
                  dataKey="value"
                  innerRadius={60}
                  outerRadius={77}
                  paddingAngle={equipment.length > 1 ? 4 : 0}
                  cornerRadius={4}
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {stateData.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-label">
              <strong>{equipment.length}</strong>
              <span>equipos</span>
            </div>
          </div>
          <div className="state-legend">
            {stateData.map((s) => (
              <div key={s.name}>
                <span>
                  <i style={{ background: s.color }} />
                  {s.name}
                </span>
                <strong>{s.value.toString().padStart(2, '0')}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>
              Equipos del laboratorio <span className="number-pill">{equipment.length}</span>
            </h2>
            <p>Configuración, disponibilidad y uso actual</p>
          </div>
          <button className="text-button" onClick={() => navigate('equipment')}>
            Ver todos los equipos <ArrowUpRight size={15} />
          </button>
        </div>
        <EquipmentTable
          equipment={equipment.slice(0, 5)}
          settings={data.settings}
          openEquipment={openEquipment}
        />
      </section>
      <div className="bottom-grid">
        <section className="panel alerts-panel">
          <div className="panel-title">
            <div>
              <h2>
                Requieren atención <span className="number-pill warm">{data.alerts.length}</span>
              </h2>
              <p>Alertas activas según los umbrales configurados</p>
            </div>
            <Bell size={18} className="muted" />
          </div>
          {!data.alerts.length ? (
            <div className="quiet-state">
              <CheckCircle2 size={20} />
              <p>No hay alertas activas.</p>
            </div>
          ) : (
            data.alerts.slice(0, 4).map((alert) => (
              <button
                className="alert-row"
                key={alert.id}
                onClick={() => openEquipment(alert.equipmentId)}
              >
                <span className={`alert-icon ${alert.severity}`}>
                  <AlertTriangle size={16} />
                </span>
                <span>
                  <strong>{alert.equipmentLabel}</strong>
                  <small>{alert.message}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))
          )}
        </section>
        <section className="insight-card">
          <span className="insight-icon">
            <ShieldCheck size={26} />
          </span>
          <span className="eyebrow">CADA CAMBIO TIENE UNA HISTORIA</span>
          <h2>Control con trazabilidad.</h2>
          <p>
            Las solicitudes conservan el estado actual hasta recibir la aprobación explícita de un
            administrador.
          </p>
          <button className="text-button" onClick={() => navigate('requests')}>
            Consultar solicitudes <ArrowUpRight size={16} />
          </button>
        </section>
      </div>
    </>
  );
}

function EquipmentTable({
  equipment,
  settings,
  openEquipment,
}: {
  equipment: Equipment[];
  settings: Settings;
  openEquipment: (id: string) => void;
}) {
  if (!equipment.length)
    return (
      <Empty title="No se encontraron equipos">
        Ajusta los filtros o registra un nuevo equipo.
      </Empty>
    );
  return (
    <div className="table-scroll">
      <table className="equipment-table">
        <thead>
          <tr>
            <th>Equipo</th>
            <th>Sistema operativo</th>
            <th>Ubicación</th>
            <th>Estado</th>
            <th>CPU</th>
            <th>RAM</th>
            <th>
              <span className="sr-only">Detalle</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {equipment.map((e) => (
            <tr key={e.id}>
              <td>
                <button className="equipment-name" onClick={() => openEquipment(e.id)}>
                  <span className={`device-icon ${e.online ? '' : 'muted-device'}`}>
                    <Monitor size={19} />
                    <span className={`device-dot ${e.online ? '' : 'offline'}`} />
                  </span>
                  <span>
                    <strong>{e.inventory?.hostname || e.label}</strong>
                    <small>
                      {e.assetTag} {e.demo && <span className="sample-tag">MUESTRA</span>}
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <span className="cell-primary">
                  {activeOS(e)?.name || 'Sin reporte'} {activeOS(e)?.version || ''}
                </span>
                <span className="cell-secondary">{bootLabel(e)}</span>
              </td>
              <td>
                <span className="cell-primary">{e.location.container}</span>
                <span className="cell-secondary">{e.location.position}</span>
              </td>
              <td>
                <StateBadge state={e.state} />
                {e.pendingRequest && (
                  <span className="pending-note">
                    <Clock size={10} /> Cambio pendiente
                  </span>
                )}
              </td>
              <td>
                <Meter value={e.latestMetric?.cpuPercent} threshold={settings.cpuThreshold} />
              </td>
              <td>
                <Meter value={e.latestMetric?.ramPercent} threshold={settings.ramThreshold} />
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`Ver ${e.assetTag}`}
                  onClick={() => openEquipment(e.id)}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function EquipmentPage({
  data,
  user,
  openEquipment,
  onCreate,
}: {
  data: Dashboard;
  user: User;
  openEquipment: (id: string) => void;
  onCreate: () => void;
}) {
  const [search, setSearch] = useState(''),
    [state, setState] = useState(''),
    [boot, setBoot] = useState(''),
    [os, setOS] = useState(''),
    [location, setLocation] = useState(''),
    [minCPU, setMinCPU] = useState(''),
    [maxCPU, setMaxCPU] = useState('');
  const equipment = data.equipment.filter(
    (e) =>
      (!search ||
        `${e.label} ${e.assetTag} ${e.inventory?.hostname} ${e.inventory?.architecture}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!state || e.state === state) &&
      (!boot || (e.inventory?.bootType || 'UNKNOWN') === boot) &&
      (!os || e.inventory?.operatingSystems.some((o) => o.name === os)) &&
      (!location || e.location.container === location) &&
      (!minCPU || (e.latestMetric && e.latestMetric.cpuPercent >= Number(minCPU))) &&
      (!maxCPU || (e.latestMetric && e.latestMetric.cpuPercent <= Number(maxCPU))),
  );
  return (
    <>
      <PageHeading
        eyebrow="INVENTARIO CENTRALIZADO"
        title="Cada equipo, en detalle."
        description="Encuentra la configuración y los recursos que necesitas en el laboratorio."
        action={
          user.role === 'ADMIN' && (
            <button className="button primary" onClick={onCreate}>
              <Plus size={17} /> Registrar equipo
            </button>
          )
        }
      />
      <section className="panel">
        <div className="filters">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Buscar equipos"
              placeholder="Buscar equipo, activo o arquitectura…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filtrar por estado"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {STATE_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por arranque"
            value={boot}
            onChange={(e) => setBoot(e.target.value)}
          >
            <option value="">Todos los arranques</option>
            <option value="SINGLE">Single Boot</option>
            <option value="MULTI">Multi Boot</option>
            <option value="UNKNOWN">Por verificar</option>
          </select>
          <select aria-label="Filtrar por SO" value={os} onChange={(e) => setOS(e.target.value)}>
            <option value="">Todos los SO</option>
            {[
              ...new Set(
                data.equipment.flatMap(
                  (e) => e.inventory?.operatingSystems.map((os) => os.name) || [],
                ),
              ),
            ].map((os) => (
              <option key={os}>{os}</option>
            ))}
          </select>
          <select
            aria-label="Filtrar por ubicación"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            <option value="">Todas las ubicaciones</option>
            {[...new Set(data.equipment.map((e) => e.location.container))].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
        <div className="filter-summary">
          <span>
            <SlidersHorizontal size={14} /> {equipment.length} de {data.equipment.length} equipos
          </span>
          <div className="range-filter">
            <label>
              CPU{' '}
              <input
                type="number"
                min="0"
                max="100"
                placeholder="Mín."
                value={minCPU}
                onChange={(e) => setMinCPU(e.target.value)}
              />
            </label>
            <span>—</span>
            <input
              aria-label="CPU máxima"
              type="number"
              min="0"
              max="100"
              placeholder="Máx."
              value={maxCPU}
              onChange={(e) => setMaxCPU(e.target.value)}
            />
            <span>%</span>
            <button
              className="text-button"
              onClick={() => {
                setSearch('');
                setState('');
                setBoot('');
                setOS('');
                setLocation('');
                setMinCPU('');
                setMaxCPU('');
              }}
            >
              Limpiar
            </button>
          </div>
        </div>
        <EquipmentTable
          equipment={equipment}
          settings={data.settings}
          openEquipment={openEquipment}
        />
      </section>
    </>
  );
}

function MapPage({
  data,
  openEquipment,
}: {
  data: Dashboard;
  openEquipment: (id: string) => void;
}) {
  const [lab, setLab] = useState(''),
    [zone, setZone] = useState('');
  const equipment = data.equipment.filter(
    (e) => (!lab || e.location.lab === lab) && (!zone || e.location.container === zone),
  );
  const containers = [
    ...new Set(equipment.map((e) => `${e.location.lab}|${e.location.container}`)),
  ];
  return (
    <>
      <PageHeading
        eyebrow="LOCALIZACIÓN FÍSICA"
        title="Tu laboratorio, en el mapa."
        description="Ubicaciones registradas por el personal autorizado. Selecciona un equipo para ver su detalle."
      />
      <section className="panel">
        <div className="panel-title">
          <div className="button-row">
            <select
              aria-label="Filtrar laboratorio"
              value={lab}
              onChange={(e) => {
                setLab(e.target.value);
                setZone('');
              }}
            >
              <option value="">Todos los laboratorios</option>
              {[...new Set(data.equipment.map((e) => e.location.lab))].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <select
              aria-label="Filtrar zona"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            >
              <option value="">Todas las zonas</option>
              {[
                ...new Set(
                  data.equipment
                    .filter((e) => !lab || e.location.lab === lab)
                    .map((e) => e.location.container),
                ),
              ].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
          <span className="muted">{equipment.length} equipos ubicados</span>
        </div>
        {!equipment.length ? (
          <Empty title="Sin ubicaciones">
            Registra equipos con su laboratorio, contenedor y puesto.
          </Empty>
        ) : (
          <div className="lab-map">
            {containers.map((container) => {
              const [room, name] = container.split('|');
              const items = equipment.filter(
                (e) => e.location.lab === room && e.location.container === name,
              );
              return (
                <div className="map-island" key={container}>
                  <div className="island-heading">
                    <span>
                      <MapPin size={15} />
                      {name}
                    </span>
                    <small>{room}</small>
                  </div>
                  <div className="map-devices">
                    {items.map((e) => (
                      <button
                        key={e.id}
                        className={`map-device map-${e.state}`}
                        onClick={() => openEquipment(e.id)}
                      >
                        <Monitor size={30} strokeWidth={1.4} />
                        <strong>{e.assetTag}</strong>
                        <small>{e.location.position}</small>
                        <span className={`status-dot ${e.online ? '' : 'offline'}`} />
                        {e.location.x !== null && e.location.y !== null && (
                          <span className="coordinate">
                            {e.location.x}, {e.location.y} m
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="map-entry">
              <span />
              ACCESO AL LABORATORIO
              <span />
            </div>
          </div>
        )}
        <div className="map-legend">
          {STATES.map((s) => (
            <span key={s}>
              <i style={{ background: stateColors[s] }} />
              {STATE_LABELS[s]}
            </span>
          ))}
          <span className="muted">
            Distribución esquemática · Coordenadas en metros cuando están registradas
          </span>
        </div>
      </section>
    </>
  );
}

function RequestsPage({
  data,
  user,
  onRequest,
  onDecision,
  openEquipment,
}: {
  data: Dashboard;
  user: User;
  onRequest: () => void;
  onDecision: (request: ChangeRequest, decision: 'APPROVED' | 'REJECTED' | 'CANCELLED') => void;
  openEquipment: (id: string) => void;
}) {
  const [tab, setTab] = useState('PENDING');
  const requests = data.requests.filter((r) => tab === 'ALL' || r.status === tab);
  return (
    <>
      <PageHeading
        eyebrow="CAMBIOS CON APROBACIÓN"
        title={user.role === 'ADMIN' ? 'Decisiones con contexto.' : 'Tus solicitudes, al día.'}
        description="El estado del equipo se conserva hasta que un administrador apruebe el cambio."
        action={
          <button className="button primary" onClick={onRequest}>
            <Plus size={17} /> Nueva solicitud
          </button>
        }
      />
      <section className="panel">
        <div className="tabs">
          {[
            ['PENDING', 'Pendientes'],
            ['APPROVED', 'Aprobadas'],
            ['REJECTED', 'Rechazadas'],
            ['ALL', 'Todas'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={tab === value ? 'active' : ''}
              onClick={() => setTab(value)}
            >
              {label}
              <span>
                {data.requests.filter((r) => value === 'ALL' || r.status === value).length}
              </span>
            </button>
          ))}
        </div>
        {!requests.length ? (
          <Empty title="Sin solicitudes en esta vista">
            Las solicitudes que registres aparecerán aquí con su estado de revisión.
          </Empty>
        ) : (
          <div className="requests-list">
            {requests.map((r) => (
              <article className="request-card" key={r.id}>
                <div className="request-main">
                  <div className="request-top">
                    <button className="text-button" onClick={() => openEquipment(r.equipmentId)}>
                      <Monitor size={17} />
                      {r.assetTag} · {r.equipmentLabel}
                    </button>
                    <span className={`badge request-${r.status}`}>{statusLabel[r.status]}</span>
                  </div>
                  <div className="transition">
                    <StateBadge state={r.fromState} />
                    <ChevronRight size={16} />
                    <StateBadge state={r.toState} />
                  </div>
                  <p className="justification">{r.justification}</p>
                  <div className="request-meta">
                    <span>
                      <Users size={13} />
                      {r.requesterName}
                    </span>
                    <span>
                      <Clock size={13} />
                      {formatDate(r.createdAt)}
                    </span>
                    {r.reviewedAt && (
                      <span>
                        Resuelta por {r.reviewerName} · {formatDate(r.reviewedAt)}
                      </span>
                    )}
                  </div>
                  {r.comment && <p className="review-comment">Comentario: {r.comment}</p>}
                </div>
                {r.status === 'PENDING' && (
                  <div className="request-actions">
                    {user.role === 'ADMIN' && (
                      <>
                        <button
                          className="button primary small"
                          onClick={() => onDecision(r, 'APPROVED')}
                        >
                          <Check size={15} /> Aprobar
                        </button>
                        <button className="button small" onClick={() => onDecision(r, 'REJECTED')}>
                          <X size={15} /> Rechazar
                        </button>
                      </>
                    )}
                    {r.requesterId === user.id && (
                      <button className="text-button" onClick={() => onDecision(r, 'CANCELLED')}>
                        Cancelar solicitud
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function DetailPage({
  id,
  data,
  user,
  refreshId,
  back,
  onRequest,
  onLocation,
  onArchive,
  tell,
}: {
  id: string;
  data: Dashboard;
  user: User;
  refreshId: number;
  back: () => void;
  onRequest: (equipment: Equipment) => void;
  onLocation: (equipment: Equipment) => void;
  onArchive: (equipment: Equipment) => void;
  tell: (message: string, error?: boolean) => void;
}) {
  const [detail, setDetail] = useState<DetailData | null>(null),
    [range, setRange] = useState('24'),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const from = new Date(Date.now() - Number(range) * 3600000).toISOString();
    api<DetailData>(`/equipment/${id}?from=${encodeURIComponent(from)}`, {}, false)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, refreshId, range]);
  useEffect(() => setDetail(null), [id]);
  if (!detail)
    return (
      <>
        <button className="text-button" onClick={back}>
          <ArrowLeft size={16} /> Volver al inventario
        </button>
        <Empty title={error || 'Cargando el equipo…'} />
      </>
    );
  const e = data.equipment.find((e) => e.id === id) || detail.equipment,
    inv = e.inventory;
  return (
    <>
      <button className="text-button back-button" onClick={back}>
        <ArrowLeft size={16} /> Volver al inventario
      </button>
      <PageHeading
        eyebrow={`${e.assetTag}${e.demo ? ' · EQUIPO DE MUESTRA' : ''}`}
        title={e.label}
        description={`${inv?.hostname || 'Pendiente de enrolamiento'} · Último reporte: ${formatDate(e.lastSeen)}`}
        action={
          <div className="button-row">
            <StateBadge state={e.state} />
            <button
              className="button primary"
              disabled={Boolean(e.pendingRequest) || e.archived}
              onClick={() => onRequest(e)}
            >
              <Plus size={16} /> {e.pendingRequest ? 'Cambio pendiente' : 'Solicitar cambio'}
            </button>
          </div>
        }
      />
      {error && <div className="connection-banner">{error}</div>}
      <div className="detail-stats">
        {[
          {
            Icon: Cpu,
            label: 'Procesador',
            value: inv?.cpuModel || 'Sin reporte',
            note: inv
              ? `${inv.physicalCores} núcleos · ${inv.logicalCores} hilos · ${inv.architecture}`
              : 'Esperando al agente',
          },
          {
            Icon: MemoryStick,
            label: 'Memoria instalada',
            value: inv ? gb(inv.ramTotalBytes) : 'Sin reporte',
            note: e.latestMetric
              ? `${gb(e.latestMetric.ramUsedBytes)} en uso · ${gb(e.latestMetric.ramAvailableBytes)} disponibles`
              : 'Sin medición',
          },
          {
            Icon: HardDrive,
            label: 'Almacenamiento',
            value: inv
              ? gb(inv.disks.reduce((sum, disk) => sum + disk.totalBytes, 0))
              : 'Sin reporte',
            note: `${inv?.partitions.length || 0} particiones identificadas`,
          },
          {
            Icon: e.online ? Wifi : WifiOff,
            label: 'Conectividad',
            value: e.online ? 'En línea' : 'Fuera de línea',
            note: `Latido cada ${e.reportingInterval} s`,
          },
        ].map((stat) => (
          <div className="detail-stat panel" key={stat.label}>
            <stat.Icon size={19} />
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <small>{stat.note}</small>
          </div>
        ))}
      </div>
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Sistemas y configuración de arranque</h2>
              <p>
                {bootLabel(e)} · {inv?.firmware || 'Sin verificar'} ·{' '}
                {inv?.bootManager || 'Sin reporte'}
              </p>
            </div>
            <Server size={20} className="muted" />
          </div>
          {inv?.bootReason && (
            <div className="inline-warning">
              <AlertTriangle size={16} />
              {inv.bootReason}
            </div>
          )}
          <div className="os-list">
            {inv?.operatingSystems.map((os) => (
              <div className="os-card" key={os.id}>
                <span className="os-icon">
                  <Monitor size={21} />
                </span>
                <div>
                  <strong>
                    {os.name} {os.version}
                  </strong>
                  <small>
                    {os.architecture} · {os.partition || 'Partición no identificada'}
                  </small>
                  <small>
                    {os.active
                      ? 'SO activo'
                      : os.inferred
                        ? 'Instalación inferida; sin ejecución actual'
                        : 'SO inactivo'}{' '}
                    ·{' '}
                    {os.agentInstalled
                      ? `Última telemetría: ${formatDate(os.lastSeen)}`
                      : 'Agente no instalado'}
                  </small>
                </div>
                <span className={`badge ${os.active ? 'request-APPROVED' : 'neutral'}`}>
                  {os.active ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            )) || (
              <Empty title="Inventario pendiente">
                Enrola un agente e inicia su ejecución en este equipo.
              </Empty>
            )}
          </div>
          {inv && (
            <p className="panel-footnote">
              Verificación de arranque: {formatDate(inv.bootVerifiedAt)}. El SO inactivo no
              determina la conectividad del equipo.
            </p>
          )}
        </section>
        <section className="panel location-panel">
          <div className="panel-title">
            <div>
              <h2>Ubicación física</h2>
              <p>Asignación manual vigente</p>
            </div>
            <MapPin size={20} className="muted" />
          </div>
          <div className="location-detail">
            <span className="large-location-icon">
              <MapPin size={27} />
            </span>
            <h3>{e.location.container}</h3>
            <p>{e.location.position}</p>
            <small>{e.location.lab}</small>
            {e.location.x !== null && (
              <small>
                Coordenadas: {e.location.x}, {e.location.y} m
              </small>
            )}
          </div>
          {(user.role === 'ADMIN' ||
            (user.role === 'SUPPORT' && data.settings.supportCanLocate)) && (
            <button className="button full" onClick={() => onLocation(e)}>
              Actualizar ubicación
            </button>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Historial de recursos</h2>
            <p>CPU, memoria y almacenamiento · registros por SO y fecha UTC</p>
          </div>
          <select
            aria-label="Periodo de métricas"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="1">Última hora</option>
            <option value="24">Últimas 24 horas</option>
            <option value="168">Últimos 7 días</option>
          </select>
        </div>
        <div className="chart-legend">
          <span>
            <i style={{ background: '#438776' }} /> CPU
          </span>
          <span>
            <i style={{ background: '#c5a56d' }} /> RAM
          </span>
          <span>
            <i style={{ background: '#8998cc' }} /> Disco
          </span>
        </div>
        <Chart metrics={detail.metrics} />
        {detail.truncated && (
          <p className="panel-footnote">
            Se muestran las 2.000 mediciones más recientes del periodo.
          </p>
        )}
      </section>
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Particiones de almacenamiento</h2>
              <p>Discos, sistemas de archivos y SO asociado</p>
            </div>
            <HardDrive size={19} className="muted" />
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Partición / disco</th>
                  <th>Sistema de archivos</th>
                  <th>Capacidad</th>
                  <th>Uso</th>
                </tr>
              </thead>
              <tbody>
                {inv?.partitions.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <strong>{p.name}</strong>
                      <span className="cell-secondary">
                        {p.disk} · {p.mountpoint} · {p.os || 'Sin SO asociado'}
                      </span>
                    </td>
                    <td>{p.filesystem}</td>
                    <td>{gb(p.totalBytes)}</td>
                    <td>
                      <Meter
                        value={p.totalBytes ? (p.usedBytes / p.totalBytes) * 100 : 0}
                        threshold={data.settings.diskThreshold}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!inv?.partitions.length && (
              <p className="panel-footnote">Sin particiones reportadas.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Adaptadores de red</h2>
              <p>Configuración técnica del equipo</p>
            </div>
            <Network size={19} className="muted" />
          </div>
          <div className="adapter-list">
            {inv?.adapters.map((adapter, i) => (
              <div className="adapter" key={i}>
                <div>
                  <strong>{adapter.name}</strong>
                  <span className={`badge ${adapter.up ? 'request-APPROVED' : 'neutral'}`}>
                    {adapter.up ? 'Enlace activo' : 'Sin enlace'}
                  </span>
                </div>
                <small>MAC: {adapter.mac || 'No disponible'}</small>
                <small>IPv4: {adapter.ipv4.join(', ') || 'No disponible'}</small>
                <small>IPv6: {adapter.ipv6.join(', ') || 'No disponible'}</small>
                <small>
                  {adapter.speedMbps} Mbps · {Math.round(adapter.bytesReceived / 1024)} KiB
                  recibidos
                </small>
              </div>
            )) || <p className="panel-footnote">Sin adaptadores reportados.</p>}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Tráfico de red</h2>
            <p>Velocidad de envío y recepción en KiB/s</p>
          </div>
          <Network size={18} className="muted" />
        </div>
        <Chart metrics={detail.metrics} mode="network" />
      </section>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Historial del equipo</h2>
            <p>Cambios de estado, ubicación y arranque conservados</p>
          </div>
          <Clock size={18} className="muted" />
        </div>
        <div className="timeline">
          {detail.history.length ? (
            detail.history.map((event) => (
              <div key={event.id} className="timeline-event">
                <span className="timeline-dot" />
                <div>
                  <strong>
                    {
                      (
                        {
                          EQUIPMENT_CREATED: 'Equipo registrado',
                          STATE_APPROVED: 'Cambio de estado aprobado',
                          LOCATION_CHANGED: 'Ubicación actualizada',
                          BOOT_CHANGED: 'Configuración de arranque actualizada',
                        } as Record<string, string>
                      )[event.action]
                    }
                  </strong>
                  <small>
                    {formatDate(event.createdAt)} · {event.actorName}
                  </small>
                  <pre>{JSON.stringify(event.detail, null, 2)}</pre>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">Aún no hay eventos.</p>
          )}
        </div>
      </section>
      {user.role === 'ADMIN' && !e.demo && !e.archived && (
        <div className="archive-row">
          <p>La baja conserva el historial y revoca las credenciales de los agentes.</p>
          <button
            className="button danger"
            disabled={e.state !== 'FUERA_SERVICIO' || Boolean(e.pendingRequest)}
            onClick={() => onArchive(e)}
          >
            Dar de baja
          </button>
        </div>
      )}
    </>
  );
}

function ReportsPage({ tell }: { tell: (message: string, error?: boolean) => void }) {
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10)),
    [busy, setBusy] = useState('');
  async function exportReport(type: string, format: string) {
    setBusy(`${type}-${format}`);
    try {
      if (from > to) throw new Error('El inicio del periodo debe ser anterior al final.');
      const start = new Date(`${from}T00:00:00`).toISOString(),
        end = new Date(`${to}T23:59:59`).toISOString();
      await downloadReport(
        `/reports/${format}?type=${type}&from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`,
        `smtel-${type}.${format}`,
      );
      tell('Reporte descargado.');
    } catch (err) {
      tell((err as Error).message, true);
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="DATOS PARA TOMAR DECISIONES"
        title="La historia, en tus manos."
        description="Consulta y exporta la información almacenada del laboratorio."
      />
      <section className="panel report-period">
        <div>
          <h2>Periodo del reporte</h2>
          <p>
            Aplica a historiales y uso de recursos. El inventario refleja la configuración vigente.
          </p>
        </div>
        <div className="button-row">
          <label>
            Desde
            <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" required value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </section>
      <div className="reports-grid">
        {[
          {
            type: 'inventory',
            title: 'Inventario de equipos',
            description:
              'Identidad, hardware, sistemas instalados, estado y ubicación vigente de cada equipo.',
            Icon: Monitor,
          },
          {
            type: 'states',
            title: 'Historial de estados',
            description:
              'Transiciones aprobadas, responsables y trazabilidad de las decisiones tomadas.',
            Icon: ClipboardList,
          },
          {
            type: 'locations',
            title: 'Historial de ubicaciones',
            description:
              'Reubicaciones, posición anterior y nueva, fecha y responsable del cambio.',
            Icon: MapPin,
          },
          {
            type: 'usage',
            title: 'Uso de recursos',
            description: 'CPU, RAM y disco por equipo y SO, con promedios y máximos del periodo.',
            Icon: Activity,
          },
        ].map((report) => (
          <section className="panel report-card" key={report.type}>
            <span className="report-icon">
              <report.Icon size={24} />
            </span>
            <h2>{report.title}</h2>
            <p>{report.description}</p>
            <div className="button-row">
              {['csv', 'pdf'].map((format) => (
                <button
                  className="button"
                  key={format}
                  disabled={Boolean(busy)}
                  onClick={() => void exportReport(report.type, format)}
                >
                  {busy === `${report.type}-${format}` ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Download size={16} />
                  )}{' '}
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function AdminPage({
  data,
  refreshId,
  perform,
  onCredentials,
}: {
  data: Dashboard;
  refreshId: number;
  perform: (operation: () => Promise<unknown>, success: string) => Promise<boolean>;
  onCredentials: (title: string, value: unknown, filename: string) => void;
}) {
  const [tab, setTab] = useState('agents'),
    [users, setUsers] = useState<User[]>([]),
    [agents, setAgents] = useState<
      {
        id: string;
        equipmentId: string;
        osId: string;
        revoked: boolean;
        createdAt: string;
        assetTag: string;
      }[]
    >([]),
    [auditData, setAuditData] = useState<{ valid: boolean; events: Audit[] } | null>(null),
    [config, setConfig] = useState(data.settings),
    [equipmentId, setEquipmentId] = useState(''),
    [osId, setOsId] = useState('windows'),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [role, setRole] = useState<User['role']>('MEMBER'),
    [busy, setBusy] = useState(false),
    [loadError, setLoadError] = useState(''),
    [revokeId, setRevokeId] = useState('');
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [u, a] = await Promise.all([
          api<User[]>('/users', {}, false),
          api<typeof agents>('/agents', {}, false),
        ]);
        if (!cancelled) {
          setUsers(u);
          setAgents(a);
          setLoadError('');
        }
        if (tab === 'audit') {
          const value = await api<typeof auditData>('/audit', {}, false);
          if (!cancelled) setAuditData(value);
        }
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshId, tab]);
  async function submitAgent(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    let credentials: unknown;
    const ok = await perform(async () => {
      credentials = await post('/agents', { equipmentId, osId });
    }, 'Agente enrolado. Descarga su configuración.');
    if (ok) onCredentials('Configuración del agente', credentials, `smtel-agent-${osId}.json`);
    setBusy(false);
  }
  async function submitUser(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    let result: { mfaSecret?: string; mfaUri?: string } | undefined;
    const ok = await perform(async () => {
      result = await post('/users', { name, email, password, role });
    }, 'Usuario creado.');
    if (ok) {
      setName('');
      setEmail('');
      setPassword('');
      if (result?.mfaSecret)
        onCredentials('Activación del autenticador MFA', result, 'smtel-mfa.json');
    }
    setBusy(false);
  }
  async function updateUser(user: User, nextRole: User['role'], active: boolean) {
    let result: { mfaSecret?: string } | undefined;
    const ok = await perform(async () => {
      result = await mutate(`/users/${user.id}`, 'PATCH', { role: nextRole, active });
    }, 'Acceso actualizado; las sesiones anteriores fueron revocadas.');
    if (ok && result?.mfaSecret)
      onCredentials(
        'Activación del autenticador MFA',
        { email: user.email, ...result },
        'smtel-mfa.json',
      );
  }
  return (
    <>
      <PageHeading
        eyebrow="GOBIERNO DEL LABORATORIO"
        title="Configuración y control."
        description="Gestiona agentes, accesos, umbrales y el registro de auditoría."
      />
      <div className="admin-tabs tabs">
        {[
          { id: 'agents', label: 'Agentes', Icon: KeyRound },
          { id: 'users', label: 'Usuarios', Icon: Users },
          { id: 'settings', label: 'Parámetros', Icon: Settings2 },
          { id: 'audit', label: 'Auditoría', Icon: Fingerprint },
        ].map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            <item.Icon size={16} />
            {item.label}
          </button>
        ))}
      </div>
      {loadError && <div className="connection-banner">{loadError}</div>}
      {tab === 'agents' && (
        <>
          <section className="panel admin-form-panel">
            <div className="panel-title">
              <div>
                <h2>Enrolar un agente</h2>
                <p>Una credencial propia para cada SO de cada equipo real.</p>
              </div>
            </div>
            <form className="inline-form" onSubmit={submitAgent}>
              <label>
                Equipo
                <select
                  required
                  value={equipmentId}
                  onChange={(e) => setEquipmentId(e.target.value)}
                >
                  <option value="">Seleccionar equipo real</option>
                  {data.equipment
                    .filter((e) => !e.demo)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.assetTag} · {e.label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Identificador del SO
                <input
                  value={osId}
                  onChange={(e) => setOsId(e.target.value)}
                  placeholder="windows / linux"
                  required
                  maxLength={200}
                />
              </label>
              <button className="button primary" disabled={busy || !equipmentId}>
                <Plus size={16} /> Enrolar y descargar
              </button>
            </form>
            <p className="panel-footnote">
              Instala el agente Python en cada SO. La configuración descargada contiene
              credenciales: entrégala únicamente al equipo correspondiente.
            </p>
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>Agentes registrados</h2>
              <span className="number-pill">{agents.length}</span>
            </div>
            {!agents.length ? (
              <Empty title="Sin agentes enrolados">
                Registra un equipo real y genera la configuración de su agente.
              </Empty>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Equipo</th>
                      <th>SO</th>
                      <th>Alta</th>
                      <th>Credencial</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => (
                      <tr key={agent.id}>
                        <td>{agent.assetTag}</td>
                        <td>{agent.osId}</td>
                        <td>{formatDate(agent.createdAt)}</td>
                        <td>
                          <span
                            className={`badge ${agent.revoked ? 'request-REJECTED' : 'request-APPROVED'}`}
                          >
                            {agent.revoked ? 'Revocada' : 'Activa'}
                          </span>
                        </td>
                        <td>
                          {!agent.revoked &&
                            (revokeId === agent.id ? (
                              <div className="button-row">
                                <button
                                  className="button danger small"
                                  onClick={() => {
                                    void perform(
                                      () => post(`/agents/${agent.id}/revoke`, {}),
                                      'Credencial revocada.',
                                    );
                                    setRevokeId('');
                                  }}
                                >
                                  Confirmar revocación
                                </button>
                                <button className="text-button" onClick={() => setRevokeId('')}>
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <button
                                className="text-button danger-text"
                                onClick={() => setRevokeId(agent.id)}
                              >
                                Revocar
                              </button>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {tab === 'users' && (
        <>
          <section className="panel admin-form-panel">
            <div className="panel-title">
              <div>
                <h2>Crear usuario</h2>
                <p>Todos los administradores deben configurar un autenticador TOTP.</p>
              </div>
            </div>
            <form className="inline-form user-form" onSubmit={submitUser}>
              <label>
                Nombre
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  minLength={2}
                  maxLength={200}
                />
              </label>
              <label>
                Correo
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Contraseña inicial
                <input
                  type="password"
                  required
                  value={password}
                  minLength={12}
                  maxLength={200}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 12 caracteres"
                  autoComplete="new-password"
                />
              </label>
              <label>
                Rol
                <select value={role} onChange={(e) => setRole(e.target.value as User['role'])}>
                  {Object.entries(roleLabels).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button primary" disabled={busy}>
                <Plus size={16} /> Crear usuario
              </button>
            </form>
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>Accesos al sistema</h2>
              <span className="number-pill">{users.length}</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Acceso</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.name}</strong>
                        <span className="cell-secondary">{user.email}</span>
                      </td>
                      <td>
                        <select
                          aria-label={`Rol de ${user.name}`}
                          value={user.role}
                          onChange={(e) =>
                            void updateUser(user, e.target.value as User['role'], user.active)
                          }
                        >
                          {Object.entries(roleLabels).map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{user.active ? 'Activo' : 'Desactivado'}</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => void updateUser(user, user.role, !user.active)}
                        >
                          {user.active ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {tab === 'settings' && (
        <section className="panel admin-form-panel">
          <div className="panel-title">
            <div>
              <h2>Parámetros operativos</h2>
              <p>
                Valores iniciales propuestos por el documento de visión; revisables por el
                laboratorio.
              </p>
            </div>
          </div>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              await perform(
                () => mutate('/settings', 'PUT', config),
                'Configuración guardada y auditada.',
              );
              setBusy(false);
            }}
          >
            <div className="settings-grid">
              {[
                { key: 'reportingInterval', label: 'Intervalo de reporte (s)', min: 10, max: 3600 },
                {
                  key: 'storageInterval',
                  label: 'Inventario de almacenamiento (s)',
                  min: 30,
                  max: 86400,
                },
                {
                  key: 'offlineIntervals',
                  label: 'Intervalos para fuera de línea',
                  min: 2,
                  max: 20,
                },
                { key: 'cpuThreshold', label: 'Umbral CPU (%)', min: 1, max: 100 },
                { key: 'ramThreshold', label: 'Umbral RAM (%)', min: 1, max: 100 },
                { key: 'diskThreshold', label: 'Umbral disco (%)', min: 1, max: 100 },
                {
                  key: 'pendingAlertHours',
                  label: 'Alerta de solicitud pendiente (h)',
                  min: 0.01,
                  max: 720,
                },
                {
                  key: 'sessionIdleMinutes',
                  label: 'Expiración por inactividad (min)',
                  min: 5,
                  max: 120,
                },
                {
                  key: 'metricRetentionDays',
                  label: 'Retención de métricas (días)',
                  min: 1,
                  max: 3650,
                },
              ].map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    type="number"
                    required
                    min={field.min}
                    max={field.max}
                    step={field.key === 'pendingAlertHours' ? '0.01' : '1'}
                    value={config[field.key as keyof Settings] as number}
                    onChange={(e) => setConfig({ ...config, [field.key]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
            <div className="settings-checks">
              <label>
                <input
                  type="checkbox"
                  checked={config.supportCanLocate}
                  onChange={(e) => setConfig({ ...config, supportCanLocate: e.target.checked })}
                />{' '}
                Permitir que Soporte actualice ubicaciones
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={config.allowSelfApproval}
                  onChange={(e) => setConfig({ ...config, allowSelfApproval: e.target.checked })}
                />{' '}
                Permitir al administrador aprobar sus propias solicitudes
              </label>
            </div>
            <h3 className="form-section-heading">Matriz de transiciones permitidas</h3>
            <div className="table-scroll">
              <table className="transition-table">
                <thead>
                  <tr>
                    <th>Origen / Destino</th>
                    {STATES.map((s) => (
                      <th key={s}>{STATE_LABELS[s]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STATES.map((from) => (
                    <tr key={from}>
                      <td>{STATE_LABELS[from]}</td>
                      {STATES.map((to) => (
                        <td key={to}>
                          {from === to ? (
                            '—'
                          ) : (
                            <input
                              type="checkbox"
                              aria-label={`${STATE_LABELS[from]} a ${STATE_LABELS[to]}`}
                              checked={config.transitions[from].includes(to)}
                              onChange={(event) =>
                                setConfig({
                                  ...config,
                                  transitions: {
                                    ...config.transitions,
                                    [from]: event.target.checked
                                      ? [...config.transitions[from], to]
                                      : config.transitions[from].filter((s) => s !== to),
                                  },
                                })
                              }
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button type="button" className="button" onClick={() => setConfig(data.settings)}>
                Restablecer cambios
              </button>
              <button className="button primary" disabled={busy}>
                <Check size={16} /> Guardar configuración
              </button>
            </div>
          </form>
        </section>
      )}
      {tab === 'audit' && (
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Registro de auditoría</h2>
              <p>Eventos protegidos contra modificación y eliminación desde la aplicación.</p>
            </div>
            <span className={`badge ${auditData?.valid ? 'request-APPROVED' : 'request-REJECTED'}`}>
              <ShieldCheck size={14} />
              {auditData?.valid ? 'Cadena verificada' : 'Verificación pendiente'}
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Responsable</th>
                  <th>Evento</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {auditData?.events.map((event) => (
                  <tr key={event.id}>
                    <td className="nowrap">{formatDate(event.createdAt)}</td>
                    <td>{event.actorName}</td>
                    <td>
                      <code>{event.action}</code>
                    </td>
                    <td>
                      <details>
                        <summary>Ver registro</summary>
                        <pre className="audit-detail">{JSON.stringify(event.detail, null, 2)}</pre>
                        <small>SHA-256: {event.hash}</small>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function ActionDialog({
  dialog,
  data,
  close,
  perform,
}: {
  dialog: Dialog;
  data: Dashboard;
  close: () => void;
  perform: (operation: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false),
    [equipmentId, setEquipmentId] = useState(
      dialog.kind === 'request' ? dialog.equipment?.id || '' : '',
    ),
    [toState, setToState] = useState(''),
    [justification, setJustification] = useState(''),
    [comment, setComment] = useState(''),
    [label, setLabel] = useState(''),
    [assetTag, setAssetTag] = useState(''),
    [location, setLocation] = useState<Location>(
      dialog.kind === 'location'
        ? dialog.equipment.location
        : { lab: 'Laboratorio de desarrollo', container: '', position: '', x: null, y: null },
    );
  const title =
    dialog.kind === 'request'
      ? 'Solicitar cambio de estado'
      : dialog.kind === 'decision'
        ? `${dialog.decision === 'APPROVED' ? 'Aprobar' : dialog.decision === 'REJECTED' ? 'Rechazar' : 'Cancelar'} solicitud`
        : dialog.kind === 'location'
          ? 'Actualizar ubicación física'
          : dialog.kind === 'create'
            ? 'Registrar equipo'
            : dialog.kind === 'archive'
              ? 'Dar de baja el equipo'
              : dialog.title;
  const selected = data.equipment.find((e) => e.id === equipmentId);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const focusables = () => [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input,textarea,select',
      ) || []),
    ];
    focusables()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) close();
      if (event.key === 'Tab') {
        const items = focusables(),
          first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      prior?.focus();
    };
  }, [busy, close]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    if (dialog.kind === 'request')
      await perform(
        () => post('/requests', { equipmentId, toState, justification }),
        'Solicitud registrada. El estado actual se conserva hasta su aprobación.',
      );
    if (dialog.kind === 'decision')
      await perform(
        () =>
          post(`/requests/${dialog.request.id}/resolve`, { decision: dialog.decision, comment }),
        `Solicitud ${statusLabel[dialog.decision].toLowerCase()}.`,
      );
    if (dialog.kind === 'location')
      await perform(
        () => mutate(`/equipment/${dialog.equipment.id}/location`, 'PATCH', location),
        'Ubicación actualizada; historial conservado.',
      );
    if (dialog.kind === 'create')
      await perform(
        () => post('/equipment', { label, assetTag, location }),
        'Equipo registrado. Ya puedes enrolar su agente en Administración.',
      );
    if (dialog.kind === 'archive')
      await perform(
        () => post(`/equipment/${dialog.equipment.id}/archive`, {}),
        'Equipo dado de baja; agentes revocados e historial conservado.',
      );
    setBusy(false);
  }
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">SMTEL · GESTIÓN DE EQUIPOS</span>
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            disabled={busy}
            aria-label="Cerrar diálogo"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {dialog.kind === 'credentials' ? (
          <>
            <p className="muted">
              Descarga esta información y entrégala solo a la persona o al equipo correspondiente.
              Las credenciales de agente se muestran únicamente al enrolar.
            </p>
            <pre className="credential-preview">{JSON.stringify(dialog.value, null, 2)}</pre>
            <div className="form-actions">
              <button className="button" onClick={close}>
                Cerrar
              </button>
              <button
                className="button primary"
                onClick={() => downloadJson(dialog.filename, dialog.value)}
              >
                <Download size={17} /> Descargar configuración
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            {dialog.kind === 'request' && (
              <>
                <p className="muted">
                  La solicitud necesita aprobación del Administrador del Sistema.
                </p>
                <label>
                  Equipo
                  <select
                    required
                    value={equipmentId}
                    onChange={(e) => {
                      setEquipmentId(e.target.value);
                      setToState('');
                    }}
                  >
                    <option value="">Selecciona un equipo</option>
                    {data.equipment
                      .filter((e) => !e.pendingRequest)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.assetTag} · {e.label}
                        </option>
                      ))}
                  </select>
                </label>
                {selected && (
                  <div className="current-state">
                    Estado vigente <StateBadge state={selected.state} />
                  </div>
                )}
                <label>
                  Estado solicitado
                  <select required value={toState} onChange={(e) => setToState(e.target.value)}>
                    <option value="">Selecciona un estado permitido</option>
                    {selected &&
                      data.settings.transitions[selected.state].map((s) => (
                        <option key={s} value={s}>
                          {STATE_LABELS[s]}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Justificación
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Describe por qué se necesita este cambio (mínimo 10 caracteres)."
                    rows={4}
                  />
                </label>
              </>
            )}
            {dialog.kind === 'decision' && (
              <>
                <p>
                  <strong>
                    {dialog.request.assetTag} · {dialog.request.equipmentLabel}
                  </strong>
                </p>
                <div className="transition">
                  <StateBadge state={dialog.request.fromState} />
                  <ChevronRight size={16} />
                  <StateBadge state={dialog.request.toState} />
                </div>
                <blockquote>{dialog.request.justification}</blockquote>
                <p className="muted">
                  {dialog.decision === 'APPROVED'
                    ? 'Al confirmar, se aplicará el nuevo estado y quedarán registrados el solicitante, el aprobador y la fecha de la decisión.'
                    : 'El estado actual del equipo se conservará.'}
                </p>
                {dialog.decision !== 'CANCELLED' && (
                  <label>
                    {dialog.decision === 'REJECTED'
                      ? 'Motivo de rechazo (obligatorio)'
                      : 'Comentario (opcional)'}
                    <textarea
                      required={dialog.decision === 'REJECTED'}
                      maxLength={2000}
                      rows={3}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </label>
                )}
              </>
            )}
            {dialog.kind === 'create' && (
              <>
                <label>
                  Nombre del equipo
                  <input
                    required
                    minLength={3}
                    maxLength={200}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Estación de desarrollo 13"
                  />
                </label>
                <label>
                  Etiqueta de activo
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={assetTag}
                    onChange={(e) => setAssetTag(e.target.value)}
                    placeholder="SMT-013"
                  />
                </label>
              </>
            )}
            {(dialog.kind === 'create' || dialog.kind === 'location') && (
              <>
                <div className="form-section-heading">Ubicación vigente</div>
                {[
                  { key: 'lab', label: 'Laboratorio / sala' },
                  { key: 'container', label: 'Mesa, isla o rack' },
                  { key: 'position', label: 'Puesto o unidad de rack' },
                ].map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input
                      required
                      maxLength={200}
                      value={String(location[field.key as keyof Location])}
                      onChange={(e) => setLocation({ ...location, [field.key]: e.target.value })}
                    />
                  </label>
                ))}
                <div className="two-column">
                  {['x', 'y'].map((key) => (
                    <label key={key}>
                      Coordenada {key} (m, opcional)
                      <input
                        type="number"
                        min="0"
                        max="1000"
                        step="0.1"
                        value={location[key as 'x' | 'y'] ?? ''}
                        onChange={(e) =>
                          setLocation({
                            ...location,
                            [key]: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
            {dialog.kind === 'archive' && (
              <>
                <p>
                  Dar de baja{' '}
                  <strong>
                    {dialog.equipment.assetTag} · {dialog.equipment.label}
                  </strong>{' '}
                  retirará el equipo del inventario activo y revocará sus agentes.
                </p>
                <p className="muted">El historial de mediciones y aprobaciones se conservará.</p>
              </>
            )}
            <div className="form-actions">
              <button className="button" type="button" disabled={busy} onClick={close}>
                Volver
              </button>
              <button
                className={`button ${dialog.kind === 'archive' || (dialog.kind === 'decision' && dialog.decision === 'REJECTED') ? 'danger' : 'primary'}`}
                disabled={busy}
              >
                {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                {dialog.kind === 'decision'
                  ? `Confirmar ${dialog.decision === 'APPROVED' ? 'aprobación' : dialog.decision === 'REJECTED' ? 'rechazo' : 'cancelación'}`
                  : dialog.kind === 'request'
                    ? 'Enviar solicitud'
                    : dialog.kind === 'archive'
                      ? 'Confirmar baja'
                      : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
