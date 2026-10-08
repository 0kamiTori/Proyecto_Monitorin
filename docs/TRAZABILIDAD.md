# Trazabilidad con el documento de visión

Fuente: `Documento_de_Vision_SMTEL.pdf`, v0.1, páginas 2 y 5–11. La Parte A es una guía de ingeniería de requisitos; la Parte B define el producto solicitado. Las propuestas y decisiones abiertas se identifican como tales y no equivalen a validación formal de stakeholders.

## Reglas y features

| Regla | Feature    | Implementación                                                                                                                                    | Evidencia                                                                                        |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| RN-01 | FEAT-01    | Agente Windows/Linux, evidencia BCD/UEFI/GRUB/particiones, SINGLE/MULTI/UNKNOWN, SO activo/inferido, fecha de verificación e historial de cambios | `agent/smtel_agent/boot.py`, ingesta y detalle de equipo; pruebas de clasificación y SO inactivo |
| RN-02 | FEAT-02    | CPU, arquitectura, RAM, swap, discos, particiones, interfaces/IP/MAC/enlace/tráfico                                                               | `collector.py`, contratos y esquema; validación de rangos en API                                 |
| RN-03 | FEAT-02/04 | Laboratorio, mesa/isla/rack, puesto/U, coordenadas en metros, historial y distribución esquemática                                                | API de ubicación, plano y prueba de permisos/historial                                           |
| RN-04 | FEAT-03    | Matriz, justificación, pendiente único, aprobación ADMIN explícita y atómica, rechazo, cancelación y notificaciones                               | Pruebas de integración y recorrido E2E de Miembro → Admin                                        |
| RN-05 | FEAT-04    | Interfaz web, sondeo de 5 s, marca de actualización, métricas almacenadas y reportes CSV/PDF                                                      | Build, integración y pruebas de interfaz                                                         |

## Requisitos no funcionales

| ID     | Implementación / estado                                                                                         | Validación necesaria                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| SEG-01 | Funciones protegidas, autenticación local y expiración por inactividad. SSO es opcional y no está integrado.    | Integración institucional si se solicita                                           |
| SEG-02 | TOTP obligatorio para todo ADMIN, incluidos alta y promoción de rol                                             | Configurar autenticadores reales y recuperación institucional                      |
| SEG-03 | RBAC en servidor; pruebas de Miembro/Soporte/Admin                                                              | Matriz de acceso validada por TI                                                   |
| SEG-04 | Compose/Caddy TLS 1.2/1.3, origen HTTPS obligatorio y cookies Secure en producción; agente verifica certificado | DNS, certificados y prueba de TLS en destino; desarrollo usa loopback HTTP         |
| SEG-05 | Credenciales propias por agente/equipo/SO y revocación                                                          | Distribución y protección de credenciales de cada equipo                           |
| SEG-06 | Auditoría append-only, triggers, cadena SHA-256 y eventos de aprobación/roles/parámetros                        | Custodia externa y conservación institucional de ≥12 meses                         |
| SEG-07 | Catálogo técnico; sin contenido personal ni actividad de usuarios                                               | Aprobar catálogo con TI; aprobación organizacional no sustituida por código        |
| DIS-01 | Aplicación y servicios desplegables; reconexión de sondeo                                                       | Medición de disponibilidad mensual 99,5% y operación continua                      |
| DIS-02 | Cola SQLite local antes de enviar, reintentos, cuarentena e idempotencia                                        | Pruebas de corte reales en cada SO; pruebas unitarias de persistencia ya incluidas |
| DIS-03 | Respaldo SQLite consistente, integridad y restauración que conserva base anterior                               | Programación diaria, copia externa y simulacro RPO/RTO                             |
| DIS-04 | Alertas de latidos, estado conectado del tablero y API autenticada de salud con alerta de ingesta >5 min        | Integración con monitoreo externo para alertar si la plataforma completa cae       |
| INT-01 | equipmentId/osId/observedAt UTC y receivedAt en cada métrica                                                    | Pruebas de esquema                                                                 |
| INT-02 | Zod, límites de tamaño/cantidades/rangos y contadores de aceptados/rechazados                                   | Casos inválidos probados                                                           |
| INT-03 | HMAC de cuerpo y fecha de envío por agente, canal HTTPS en producción                                           | Firmas/alteración probadas; TLS requiere despliegue                                |
| INT-04 | Receipts separados, UUID + hash y respuesta de duplicado                                                        | Reintentos e identificador con cuerpo distinto probados                            |
| INT-05 | Hora de envío firmada, diferencia de 60 s marcada; se distingue de observaciones recuperadas de cola            | Sincronización NTP a cargo de infraestructura                                      |
| INT-06 | Transacciones, historial append-only, conservación de aprobaciones/reubicaciones                                | Probado en integración                                                             |
| REN-01 | Interfaz compilada, dependencias de gráficas separadas, consultas indexadas                                     | Medir p95 <3 s en red local objetivo                                               |
| REN-02 | Consultas sin N+1 para última métrica, índice temporal y prueba sintética de carga                              | p95 <500 ms requiere ensayo con disco, red y TLS de producción                     |
| REN-03 | Sondeo cada 5 s; actualización sin recarga                                                                      | Medir punta a punta <10 s en laboratorio                                           |
| REN-04 | Ensayo sintético a 200 equipos y 100 consultas concurrentes                                                     | Prueba sostenida con agentes reales y margen de carga en servidor destino          |
| REN-05 | Diseño adaptable, semántica/etiquetas, foco y soporte de movimiento reducido                                    | E2E Chromium y móvil; Firefox/Edge/Safari y últimas dos versiones pendientes       |
| REN-06 | Inventario cacheado, espera entre mediciones, psutil sin lectura de procesos/actividad personal                 | Medir CPU <2% y RAM <100 MB en equipos Windows/Linux objetivo                      |

Los ID de la tabla omiten el prefijo `RNF-` únicamente para facilitar lectura. No se declara cumplimiento medido de un SLA por disponer del código o de una plantilla de despliegue.
