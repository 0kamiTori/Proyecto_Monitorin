# Resultados de validación

Fecha: **5 de octubre de 2026**, zona de trabajo America/Bogota. Entorno local Windows, Node.js 24.15.0 y Python 3.13.

## Comprobaciones terminadas

| Comprobación                                         | Resultado                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compilación TypeScript/API y build React/Vite        | Correctos; chunks de aplicación y gráficas separados                                                                                                                      |
| Pruebas de integración de API                        | **13/13** correctas                                                                                                                                                       |
| Pruebas del agente Python                            | **6/6** correctas                                                                                                                                                         |
| Recorrido Chromium de extremo a extremo              | Correcto: Miembro, solicitud, cambio de usuario, MFA Admin, aprobación, estado actualizado, plano, reporte PDF, auditoría y navegación móvil                              |
| Pantalla móvil 390 × 844                             | Sin desbordamiento horizontal del documento; la tabla usa desplazamiento dentro de su contenedor                                                                          |
| Muestra técnica real de Windows → esquema TypeScript | Correcta: 5 particiones y 6 adaptadores. Arranque UNKNOWN cuando no se pudo certificar la configuración; no se envió esa muestra al servidor                              |
| PDF de inventario                                    | Exportación de 3 páginas; presentación renderizada y comprobada                                                                                                           |
| Respaldo y restauración                              | Integridad SQLite correcta y cantidades de usuarios/equipos/métricas/solicitudes/auditoría iguales al respaldo; restauración sobre base existente conserva copia anterior |

Las pruebas de API verifican autenticación, origen autorizado, RBAC, MFA sin reutilización, aprobación atómica, pendiente único, rechazo/cancelación, ubicación, auditoría inmutable, HMAC, idempotencia, rangos, identidad del agente, cola retrasada, SO inactivo, desvío horario, protección frente a fechas futuras, expiración de sesión y exportación sin inyección de fórmulas CSV.

Las pruebas Python verifican clasificación indeterminada, HTTPS obligatorio, persistencia de cola y deduplicación local, reintentos, cuarentena/revocación, firma exacta UTF-8 y particiones Windows sin letra de unidad.

El recorrido de interfaz no produce errores JavaScript. La comprobación se ejecutó con un Chromium de pruebas local porque no había navegador conectado a la sesión.

## Carga sintética

Ensayos aislados, cliente y servidor en la misma máquina, SQLite **en memoria**, miembros con **sesiones diferentes**, dos ráfagas de reportes y dos ráfagas de consultas. El primer miembro inicia sesión por la API; las sesiones adicionales se preparan como fixture. No se mide carga de inicio de sesión ni 50/100 navegadores renderizando simultáneamente.

| Equipos | Usuarios/sesiones | Reportes | Consultas de tablero | Errores | p95 ingestión | p95 consulta |
| ------: | ----------------: | -------: | -------------------: | ------: | ------------: | -----------: |
|     100 |                50 |      200 |                  100 |       0 |        512 ms |   **165 ms** |
|     200 |               100 |      400 |                  200 |       0 |        991 ms |   **528 ms** |

El p95 de consulta está por debajo del objetivo propuesto de 500 ms en el escenario inicial. En el ensayo al doble de escala lo supera en 28 ms. No se oculta ese resultado ni se declara certificado el requisito de margen de carga: requiere un ensayo sostenido con disco, TLS y red del servidor destino. La ráfaga de 200 reportes simultáneos es distinta de reportes distribuidos cada 30 segundos durante la operación normal.

Se redujo el costo del tablero mediante consultas de última métrica sin N+1 y una instantánea común de un segundo, invalidada al completar modificaciones. Las solicitudes/notificaciones se filtran por usuario después de la instantánea compartida; no se comparten datos privados entre miembros. El sondeo web continúa cada cinco segundos.

## Evidencia y reproducción

- `npm.cmd test`: integración de API.
- Desde `agent`: `..\.venv\Scripts\python.exe -m unittest discover -s tests -v`.
- `node scripts/e2e.mjs`: recorrido sobre **demostración**, con el servidor de desarrollo activo.
- `node scripts/e2e.mjs --mobile-only`: revisión móvil sin cambiar estados.
- `npm.cmd run test:load:baseline -w @smtel/api`: 100 equipos y 50 sesiones.
- `npm.cmd run test:load`: 200 equipos y 100 sesiones.
- `npm.cmd run build`: compilación y frontend de producción.
- `.\.venv\Scripts\python.exe scripts/inspect-agent.py` y `node scripts/verify-agent-contract.mjs`: muestra local, sin transmisión. El segundo comando requiere compilar primero la API.

Las capturas/PDF quedan en `tmp/e2e/`, las mediciones en `tmp/validation/load-100-50.json` y `load-200-100.json`. Las muestras técnicas y credenciales locales no se incluyen en el ZIP del código.

## Validaciones aún dependientes del laboratorio

No se ejecutaron: detección sobre equipos Linux reales o todas las combinaciones Dual Boot/cifrado; instalación del agente como servicio en máquinas destino; Docker/Compose; DNS/TLS institucional; SSO; carga prolongada con persistencia en disco; impacto promedio del agente <2% CPU/<100 MB; compatibilidad Firefox/Edge/Safari y las dos últimas versiones; disponibilidad mensual 99,5%; respaldo diario programado externo; simulacro cronometrado de RPO/RTO. Estas comprobaciones pertenecen a la aceptación y puesta en servicio, no se sustituyen por los resultados locales.
