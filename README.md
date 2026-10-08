# SMTEL

Sistema de Monitoreo y Telemetría de Equipos de Laboratorio. Implementación basada en `Documento_de_Vision_SMTEL.pdf`, versión 0.1 del 5 de octubre de 2026.

La aplicación y la API están escritas en **TypeScript**. El agente de telemetría está escrito en **Python** y se instala en cada sistema operativo del equipo.

## Capacidades

- Inventario de CPU, arquitectura, RAM, discos, particiones y adaptadores de red.
- Detección de arranque Single/Multi/Desconocido con evidencia del gestor y las particiones. El SO inactivo conserva su última telemetría; su inactividad no desconecta el equipo completo.
- Ubicación jerárquica, coordenadas opcionales en metros, plano esquemático e historial de reubicaciones.
- Solicitudes pendientes, aprobadas, rechazadas y canceladas. Una solicitud pendiente por equipo; únicamente un administrador puede aprobar o rechazar.
- Autenticación local, roles Admin/Miembro/Soporte y segundo factor TOTP obligatorio para todos los administradores.
- Dashboard actualizado cada cinco segundos, filtros combinables, alertas y series históricas de CPU, RAM, disco y red.
- Reportes CSV/PDF: inventario, estados, ubicaciones y uso por periodo y SO.
- Alta/baja de equipos, enrolamiento y revocación de agentes, administración de usuarios y parámetros.
- Auditoría protegida por triggers y una cadena SHA-256; operaciones críticas transaccionales.
- Reportes de agente firmados con HMAC, validación de esquema y rangos, idempotencia y cola local SQLite para cortes de conexión.

## Inicio local en Windows

Requisitos: Node.js 24 o superior, npm y Python 3.11 o superior. La interfaz/API necesita Node; Python se necesita para el agente.

```powershell
cd 'C:\Proyecto Monitoreo de maquina'
npm.cmd install
npm.cmd run dev
```

Abrir **http://127.0.0.1:5173**. La API funciona en `http://127.0.0.1:4000`. En esta entrega las dependencias ya están instaladas. Para crear una instalación nueva, use `npm.cmd ci` con el lockfile entregado.

El inicio local usa demostración por defecto. Se crean doce equipos de muestra, con telemetría sintética actualizada y dos equipos sin conexión. Las etiquetas **MUESTRA** y el aviso del tablero permiten reconocerlos. Los equipos reales pueden registrarse por separado; nunca se simulan métricas para ellos.

| Rol de demostración | Correo                | Contraseña               |
| ------------------- | --------------------- | ------------------------ |
| Miembro             | `miembro@smtel.local` | `SMTEL.demo2026!`        |
| Soporte             | `soporte@smtel.local` | `SMTEL.demo2026!`        |
| Administrador       | `admin@smtel.local`   | `SMTEL.demo2026!` + TOTP |

Para entrar como administrador, importe el secreto o URI de **`data/bootstrap-mfa.json`** en un autenticador compatible con TOTP y use su código de seis dígitos. Un código ya utilizado no puede reutilizarse. Proteja ese archivo y retírelo después de configurar el autenticador. Las credenciales de demostración se ofrecen exclusivamente para desarrollo.

## Instalar un agente real

1. Entrar como administrador; registrar el equipo, su etiqueta y su ubicación.
2. En **Administración → Agentes**, seleccionar ese equipo y definir el identificador del SO, por ejemplo `windows` o `linux`.
3. Enrolar y descargar el JSON de configuración. Se muestra la credencial una sola vez.
4. Copiar la carpeta `agent` y el JSON al equipo correspondiente. Instalar Python y las dependencias:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r agent\requirements.txt
cd agent
# Guardar la configuración descargada como config.json en esta carpeta
..\.venv\Scripts\python.exe -m smtel_agent --config config.json
```

En Linux:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r agent/requirements.txt
cd agent
../.venv/bin/python -m smtel_agent --config config.json
```

`--once` recolecta/envía una medición; `--inspect` muestra la recolección local sin enviarla ni persistirla. `--spool ruta.sqlite` permite elegir dónde guardar la cola. Por defecto es `agent/spool/reports.sqlite`.

En producción la URL del servidor debe ser HTTPS. HTTP solo está permitido para `localhost`, `127.0.0.1` o `::1` en desarrollo. Si el agente está en otra máquina, configure el acceso HTTPS y el DNS antes de copiar la configuración. Nunca se desactiva la validación de certificados.

Instale y enrole un agente distinto en cada SO de un equipo con Dual Boot, **usando el mismo equipmentId y un osId distinto por instalación**. Si existe una sola instalación identificada de una familia de SO, el servidor puede correlacionar una instalación inferida con su telemetría conocida; ante ambigüedad mantiene los identificadores sin asumir equivalencias.

En Windows las consultas CIM y BCD/UEFI pueden requerir permisos elevados. El parser BCD inicial reconoce etiquetas inglesas/españolas. En Linux se usan `lsblk`, `os-prober`, `efibootmgr` y GRUB cuando están disponibles. No se instalan automáticamente ni se modifica la configuración de arranque. Si faltan herramientas, permisos o evidencia suficiente, el resultado es **UNKNOWN**, con motivo visible para revisión. La detección necesita pruebas en los equipos y configuraciones de arranque reales del laboratorio.

Los reportes se persisten antes de enviar. Tras una interrupción se prioriza la medición más reciente para actualizar la conectividad y luego se recupera la cola histórica. Reenvíos idénticos no duplican métricas. Reportes inválidos se conservan en cuarentena; una credencial revocada detiene el envío y mantiene la cola.

`deployment/smtel-agent.service` proporciona una plantilla de systemd. En Windows puede registrar el mismo comando en el Programador de tareas al arrancar, sin mostrar ventanas. La cuenta del servicio debe tener los permisos de lectura aprobados por TI. Proteja `config.json` y el directorio de la cola mediante ACL de Windows o permisos de archivo en Linux.

## Formato del código

El proyecto usa espacios: dos por nivel en TypeScript, JavaScript, JSON, HTML, CSS y YAML; cuatro en Python. `.editorconfig` define la sangría en los editores compatibles. Prettier y Black distribuyen los bloques largos para facilitar su lectura.

Desde la raíz del proyecto, formatear el código y la documentación:

```powershell
npm.cmd run format
.\.venv\Scripts\python.exe -m pip install -r agent\requirements-dev.txt
.\.venv\Scripts\python.exe -m black agent scripts
```

Comprobar el formato sin modificar archivos:

```powershell
npm.cmd run format:check
.\.venv\Scripts\python.exe -m black --check agent scripts
```

Los comandos excluyen dependencias, compilaciones, cachés y datos locales. La configuración del formato está en `.prettierrc.json` y `pyproject.toml`.

## Validación

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
cd agent
..\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Pruebas de interfaz en una base **exclusivamente de demostración** y con `npm.cmd run dev` activo:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Proyecto Monitoreo de maquina\.cache\playwright'
npx.cmd playwright install chromium
node scripts/e2e.mjs
```

El recorrido crea y aprueba una solicitud sobre SMT-002; conserva esa evidencia en la base de demostración. Al repetirlo alterna entre Operativo y Mantenimiento y cancela solicitudes pendientes creadas por ejecuciones anteriores del mismo recorrido. Las capturas y el PDF de prueba están en `tmp/e2e/`, fuera del control de versiones.

La prueba de carga trabaja en una base SQLite independiente en memoria:

```powershell
npm.cmd run test:load
```

Los resultados se guardan en `tmp/validation/load-result.json`. El alcance y los límites de las pruebas se documentan en [docs/VALIDACION.md](docs/VALIDACION.md).

## Compilación y ejecución

```powershell
npm.cmd run build
npm.cmd start
```

La API sirve también la interfaz compilada, en el puerto 4000. El modo desarrollo usa Vite en 5173. El servidor acepta ambos orígenes de loopback en desarrollo; en producción acepta exclusivamente `SMTEL_ORIGIN`.

Las variables se pueden guardar en `.env` a partir de `.env.example`. Para trabajar con datos propios, use **una base nueva** y `SMTEL_DEMO=false`, además de `SMTEL_ADMIN_EMAIL` y `SMTEL_ADMIN_PASSWORD`. Cambiar la variable no elimina usuarios ni equipos de una base existente. No reutilice la base de demostración como base de producción.

## Despliegue con HTTPS

Se incluyen Dockerfile, Compose y Caddy con TLS 1.2/1.3. Esta configuración está preparada para un servidor con DNS público y acceso a los puertos 80/443; un laboratorio con CA interna debe adaptar el certificado y la confianza de los agentes.

Crear `.env` con valores propios:

```dotenv
SMTEL_DOMAIN=smtel.laboratorio.edu
SMTEL_ADMIN_EMAIL=administrador@laboratorio.edu
SMTEL_ADMIN_PASSWORD=una-clave-propia-larga-y-unica
```

```bash
docker compose up -d --build
docker compose cp api:/app/data/bootstrap-mfa.json ./bootstrap-mfa.json
```

Importar MFA del administrador y proteger/retirar el archivo de inicialización. La API corre como usuario sin privilegios, se comunica con Caddy por la red interna y conserva los datos en un volumen propio. `SMTEL_PRODUCTION=true` exige origen HTTPS y activa cookies Secure. SSO/LDAP y notificaciones de correo quedan como integraciones opcionales.

No se han ejecutado Docker/Compose ni un despliegue público en esta máquina. Disponibilidad 99,5%, RPO/RTO, TLS institucional y compatibilidad completa de navegadores requieren puesta en servicio y medición en el entorno de destino; no se presentan como certificados.

## Respaldo y restauración

```powershell
node scripts/backup.mjs
# O indicar origen y destino:
node scripts/backup.mjs data/smtel.sqlite backups/respaldo.sqlite
```

Usa la API de respaldo de SQLite, incluyendo transacciones confirmadas en WAL, y verifica `PRAGMA integrity_check`. Programe una ejecución diaria en el Programador de tareas/systemd y copie el resultado a almacenamiento protegido separado del servidor.

Detener API y agentes antes de restaurar:

```powershell
node scripts/restore.mjs backups/respaldo.sqlite data/smtel.sqlite --services-stopped
```

La restauración verifica el respaldo y conserva una copia de la base anterior. Para Docker, ejecute el respaldo dentro del contenedor (`docker compose exec api node scripts/backup.mjs`) y extraiga el archivo desde `/app/backups`. Mida el procedimiento de restauración para validar RTO ≤4 h y RPO ≤24 h. La auditoría no se purga desde la aplicación; conserve base y respaldos al menos doce meses según la política aprobada.

## Estructura

```text
apps/api/          API, autenticación, reglas de negocio, SQLite, reportes y pruebas
apps/web/          Interfaz React + TypeScript
packages/shared/   Contratos, estados y transiciones iniciales
agent/             Agente Python, detección, transporte, cola y pruebas
deployment/        Proxy HTTPS y servicio Linux
scripts/           Verificación de interfaz, respaldo y restauración
docs/              Arquitectura, trazabilidad, backlog y validación
```

Consulte [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md), [docs/TRAZABILIDAD.md](docs/TRAZABILIDAD.md) y [docs/BACKLOG.md](docs/BACKLOG.md). Las decisiones abiertas del documento se implementan con valores explícitos y, cuando corresponde, parámetros modificables por el administrador.
