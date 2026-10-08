# Backlog y validación RUP / ágil

## Línea base implementada

| Épica         | Historia / criterio de aceptación                                                                      | Prioridad |
| ------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| Inventario    | Como Admin registro un equipo con activo único y ubicación, para enrolar sus agentes.                  | Debe      |
| SO y arranque | Como miembro identifico el SO activo, instalaciones inferidas y arranque desconocido con motivo.       | Debe      |
| Telemetría    | Como soporte consulto CPU/RAM/disco/red e historial por UTC sin inspeccionar contenido personal.       | Debe      |
| Ubicación     | Como soporte autorizado actualizo el puesto; permanece un historial de origen/destino/responsable.     | Debe      |
| Solicitudes   | Como miembro solicito un cambio con justificación; el equipo conserva el estado actual.                | Debe      |
| Aprobaciones  | Como Admin apruebo/rechazo explícitamente; se aplica una transacción con auditoría y notificación.     | Debe      |
| Seguimiento   | Como solicitante consulto mis solicitudes y cancelo únicamente las pendientes propias.                 | Debe      |
| Tablero       | Como usuario veo datos actuales, alertas, filtros y última actualización sin recargar la página.       | Debe      |
| Reportes      | Como usuario exporto inventario, estados, ubicación y uso por periodo a CSV/PDF.                       | Debe      |
| Accesos       | Como Admin gestiono usuarios/roles; ADMIN siempre requiere TOTP y los permisos se validan en servidor. | Debe      |
| Agentes       | Como Admin enrolo una credencial por SO/equipo y puedo revocarla.                                      | Debe      |
| Operación     | Como operador respaldo una base consistente y puedo restaurarla preservando la anterior.               | Debe      |

## Elaboración y puesta en servicio

1. Revisar con stakeholders los valores propuestos: retención, frecuencia, capacidad, autoaprobación y permisos de ubicación.
2. Validar detección en Windows Single, Windows/Linux Dual, Linux Single, equipos cifrados y firmware con entradas antiguas.
3. Validar reidentificación del equipo y sus SO con gestores y nombres de partición reales; resolver ambigüedades sin inferencias falsas.
4. Configurar DNS, certificado, cuenta administradora propia, MFA, NTP y política de credenciales.
5. Medir carga sostenida con disco, TLS y red reales; retención de datos; latencia de visualización.
6. Ejecutar mediciones de impacto del agente y compatibilidad Firefox/Edge/Safari además de Chromium.
7. Programar respaldo diario, proteger copias externas y ensayar restauración cronometrada.
8. Aprobar catálogo de datos técnicos y roles con TI; registrar aceptación de stakeholders y fijar línea base revisada.

## Opcionales

SSO/LDAP institucional, correo, plano a escala editable, catálogo dinámico de estados adicionales y almacenamiento de series temporales dedicado según crecimiento. No se incluyen control remoto, despliegue de software ni monitoreo de actividad personal.
