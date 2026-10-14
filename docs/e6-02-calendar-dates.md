# E6-02 — Fechas calendario en el backend

## Decisión y configuración

`HourLog.date` es un día calendario (`YYYY-MM-DD`), no un instante.

- Una cadena exacta `YYYY-MM-DD` conserva ese día y se valida como fecha real (por ejemplo, `2026-02-30` se rechaza).
- Un timestamp ISO con zona u offset, o un `Date` interno, se trata como instante: se extrae el día en la zona institucional.
- El valor persistido sigue usando el esquema `DateTime` existente, con hora `00:00:00.000Z` del día calendario normalizado.
- `INSTITUTION_TIMEZONE` configura la zona; el valor por defecto es `America/Guayaquil`. Una zona inválida impide crear la configuración de la aplicación.

`README.md` documenta esta variable. No se actualizó `.env.example`: el archivo fue denegado por la protección de acceso y se dejó completamente intacto; esa parte de S3 queda pendiente.

## Validación y compatibilidad

REST create y sync create/update usan la misma validación. Se rechazan fechas futuras según el día actual de la zona institucional y fechas fuera del rango inclusivo del Placement. El mensaje de rango muestra las fechas UTC almacenadas de inicio y fin. Un Placement sin fin, si se presenta, se valida desde su fecha de inicio en adelante.

Las fechas de Placement y los registros existentes se leen por sus componentes UTC; no se reinterpretan como instantes institucionales. Listado y exportación conservan el día UTC existente. Los cambios de revisión, borrado y actualizaciones que no escriben `date` no alteran ese campo. El resumen semanal también deriva la semana de componentes UTC, incluso para filas antiguas no guardadas a medianoche.

El esquema Prisma continúa usando `DateTime`; no se requiere migración ni backfill. Para revisar los datos sin modificarlos, ejecutar contra una base autorizada:

```bash
pnpm exec tsx prisma/calendar-date-audit.ts
```

El script solo consulta `HourLog.date` y `Placement.startDate/endDate`, informa cuántas filas tienen una hora distinta de medianoche UTC e identifica el día UTC almacenado. No actualiza ni elimina filas.

La auditoría local del 2026-10-13 terminó con código 0: inspeccionó 4000 fechas de HourLog y 400 campos de fecha de Placement; todos estaban a medianoche UTC. Por ello no hace falta una migración de datos para esa base. Este resultado no presume el estado de producción: antes de desplegar allí, ejecutar la misma auditoría autorizada. El despliegue no reescribe filas existentes.

## Pruebas

```bash
pnpm test -- src/hour-log/hour-log.service.spec.ts src/hour-log/dto/create-hour-log.dto.spec.ts src/sync/sync.service.spec.ts src/common/calendar-date.spec.ts src/common/institution-timezone.config.spec.ts
pnpm typecheck
pnpm test:cov
```

Las pruebas cubren fecha pura, offsets y dispositivos en zonas distintas, configuración Guayaquil/Madrid, fecha imposible, borde de día futuro, rango inclusivo, rechazo sin mutación, updates sin `date`, filas preexistentes no-medianoche y agrupación semanal UTC.

## Alcance

Esta unidad implementa el backend. La validación y el formato offline del frontend pertenecen a la unidad frontend de E6-02; no se agregan flujos de red ni cambios de esquema aquí.
