# E3-01 — Auditoría de autorización por endpoint

## Alcance y método

Inventario estático del backend y de los clientes REST del frontend, centrado en rutas con IDs. El backend monta todas las rutas bajo `/api` (`src/main.ts`). Los roles anotados son los exigidos por `@Roles`; si no aparece una anotación, `JwtAuthGuard` exige JWT pero no restringe el rol. “Pertenencia” significa que el servicio compara el recurso con la identidad/empresa/tutor del token. Las acciones de `COORDINATOR` se consideran globales por diseño.

Los comandos de la sección **Pruebas curl** son reproducciones pendientes de ejecutar contra datos locales. Muestran el resultado que permite la implementación actual y el resultado seguro que debería exigirse. No se afirma que se hayan ejecutado. Para pruebas de escritura usa una base local descartable y registros de prueba.

## Inventario

| # | Método y ruta | Roles permitidos | Comprueba pertenencia además del rol | Cliente frontend / evidencia |
|---|---|---|---|---|
| 1 | `POST /api/auth/login` | Público | N/A, autenticación | `src/api/client.ts` |
| 2 | `GET /api/companies` | Cualquier JWT | No (catálogo global; P01) | `src/api/companies.ts:listCompanies` |
| 3 | `POST /api/companies` | `COORDINATOR` | No (rol global; P02) | Sin llamada encontrada |
| 4 | `GET /api/offers` | Cualquier JWT | No (catálogo de publicadas; P03) | `src/api/offers.ts:listOffers` |
| 5 | `GET /api/offers/me` | `COMPANY` | Sí; consulta ofertas de la empresa del usuario | `src/api/companies.ts:listMyOffers` |
| 6 | `GET /api/offers/:id` | Cualquier JWT | No (P04): devuelve por ID sin filtrar estado ni empresa | `src/api/offers.ts:getOffer` |
| 7 | `POST /api/offers` | `COMPANY`, `COORDINATOR` | No (P05): empresa puede enviar `companyId` arbitrario | `src/api/companies.ts:createOffer` |
| 8 | `PATCH /api/offers/:id/publish` | `COMPANY`, `COORDINATOR` | No (P06): no compara empresa propietaria | `src/api/companies.ts:publishOffer` |
| 9 | `PATCH /api/offers/:id/close` | `COMPANY`, `COORDINATOR` | No (P07): no compara empresa propietaria | `src/api/companies.ts:closeOffer` |
| 10 | `POST /api/applications` | `STUDENT` | Sí; el estudiante viene del JWT | `src/api/applications.ts:apply` |
| 11 | `GET /api/offers/:offerId/applications` | `COMPANY`, `COORDINATOR` | No (P08): falta validar empresa de la oferta; expone datos personales | `src/api/companies.ts:listApplicationsForOffer` |
| 12 | `GET /api/applications/me` | `STUDENT` | Sí; filtra por ID del JWT | `src/api/applications.ts:listMine` |
| 13 | `PATCH /api/applications/:id/decide` | `COMPANY`, `COORDINATOR` | No (P09): falta validar que la postulación pertenezca a una oferta de la empresa | `src/api/companies.ts:decideApplication` |
| 14 | `GET /api/placements/accreditation?period=...` | `COORDINATOR` | No (P10; alcance global intencional) | `src/api/accreditation.ts:reportForPeriod` |
| 15 | `POST /api/placements` | `COORDINATOR` | No (P11; coordinación global). Además no valida que `tutorId` tenga rol `TUTOR` | Sin llamada REST encontrada |
| 16 | `GET /api/placements/me` | `STUDENT` | Sí; filtra por ID del JWT | Llamada por páginas/hooks de práctica |
| 17 | `PATCH /api/placements/:id/activate` | `COORDINATOR` | No (P12; control global intencional) | Sin llamada REST encontrada |
| 18 | `POST /api/placements/:id/documents` | `STUDENT`, `COORDINATOR` | Sí para estudiante; coordinador tiene alcance global | `src/pages/DocumentsPage.tsx` |
| 19 | `POST /api/hour-logs` | `STUDENT` | Sí; placement debe ser del estudiante y estar activo | Cola local, luego `src/offline/sync/push.ts` |
| 20 | `GET /api/placements/:id/hour-logs` | Cualquier JWT | Sí; coordinador, estudiante asignado o tutor asignado | `src/offline/hooks/useHourLogs.ts` / páginas |
| 21 | `GET /api/placements/:id/progress` | Cualquier JWT | Sí; mismo control de acceso al placement | `src/pages/MyPlacementPage.tsx` |
| 22 | `PATCH /api/hour-logs/:id/review` | `TUTOR` | No (P13): valida estado del registro, pero no asignación del tutor al placement | `src/pages/ReviewHoursPage.tsx` |
| 23 | `POST /api/evaluations` | `TUTOR`, `COMPANY`, `STUDENT` | Sí; el servicio compara rol y sujeto con tutor/empresa/estudiante del placement | `src/api/evaluations.ts:submitEvaluation` |
| 24 | `GET /api/placements/:id/evaluations` | Cualquier JWT | Sí; coordinador, estudiante o tutor del placement | Sin cliente específico encontrado |
| 25 | `GET /api/sync/pull` | Cualquier JWT | Sí; devuelve placements asignados como estudiante o tutor | `src/offline/sync/pull.ts` |
| 26 | `POST /api/sync/push` | Cualquier JWT | Parcial (P14): valida propietario al aplicar cambios, pero devuelve una respuesta idempotente existente por `clientOpId` sin comprobar `userId` | `src/offline/sync/push.ts` |

## Hallazgos y prioridad

| Prioridad | Hallazgo | Evidencia | Estado relacionado |
|---|---|---|---|
| **P1** | IDOR en lectura y mutación de ofertas: obtener borradores por ID, crear una oferta atribuyéndola a otra empresa, publicar o cerrar oferta ajena. | P04–P07 | Proponer subtarea de ofertas de empresa bajo E3-01. |
| **P1** | IDOR en postulaciones: leer postulantes de oferta ajena y cambiar la decisión de postulaciones ajenas. Lectura incluye nombre, correo y motivación. | P08–P09 | Comprobar si la issue existente E3-07 (#15) cubre decisiones; evitar duplicarla. Crear subtarea adicional para lectura si no está cubierta. |
| **P1** | Cualquier usuario con rol `TUTOR` puede revisar horas de otro tutor si conoce el ID. | P13 | Ya existe E3-02 (#11), “Impedir que tutor apruebe horas de práctica ajena”; relacionarla como subtarea/seguimiento de esta auditoría si la plataforma permite. |
| **P2** | `clientOpId` repetido por otro usuario puede devolver la respuesta guardada de otra operación sin validar propietario. Explotación requiere conocer el UUID. | P14 | Crear subtarea priorizada, condicionada a reproducir la respuesta cruzada en entorno local. |
| **P2** | El coordinador puede crear placement con `tutorId` que no corresponda a una cuenta TUTOR; afecta integridad de asignación. | P11 | Crear subtarea o incorporarlo a la revisión de creación de placements. |
| **N/A** | Catálogos, informes y gestión global reservados a coordinador: no usan pertenencia por recurso, pero están limitados a propósito por alcance global o lectura de catálogo. | P01–P03, P10, P12 | No crear hallazgo de autorización salvo que el equipo confirme que la lectura del catálogo no debe ser global. |

Los hallazgos P1 se consideran explotables por lectura del código: los servicios buscan por ID y omiten la comparación con la empresa/tutor del token. Se ejecutó P08 en runtime; los demás comandos siguen pendientes.

**Conteo estático:** 9 operaciones con autorización insuficiente: 7 de prioridad P1 (P04–P09 son seis operaciones y P13 una) y 2 de prioridad P2 (P11 y P14). Son 9 rutas/acciones; no son 9 CVE ni resultados confirmados por ejecución HTTP. P01–P03, P10 y P12 tienen alcance general intencional y no se cuentan como agujeros.

## Pruebas curl

### Preparación

Ejecutar desde PowerShell contra el backend local (`http://localhost:3000`). Obtener tokens con cuentas de prueba de roles distintos; adaptar correos al seed del repositorio. `curl.exe` evita el alias de PowerShell. Reemplaza `ID_AJENO` por IDs pertenecientes a otra empresa/tutor y usa datos descartables para `POST`/`PATCH`.

```powershell
$BASE = 'http://localhost:3000/api'
$student = (curl.exe -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"estudiante0@miyura.com","password":"yura1234"}' | ConvertFrom-Json).accessToken
$companyAResponse = curl.exe -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"empresa0@miyura.com","password":"yura1234"}' | ConvertFrom-Json
$companyA = $companyAResponse.accessToken
$companyBResponse = curl.exe -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"empresa1@miyura.com","password":"yura1234"}' | ConvertFrom-Json
$companyB = $companyBResponse.accessToken
$tutorA = (curl.exe -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"tutor0@miyura.com","password":"yura1234"}' | ConvertFrom-Json).accessToken
$tutorB = (curl.exe -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"tutor1@miyura.com","password":"yura1234"}' | ConvertFrom-Json).accessToken
$coord = (curl.exe -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"coordinador@miyura.com","password":"yura1234"}' | ConvertFrom-Json).accessToken
```

Estas son las cuentas definidas en `prisma/seed.ts`: todas usan `yura1234`; empresas `empresa0`–`empresa11`, tutores `tutor0`–`tutor7`, estudiantes `estudiante0`–`estudiante199` y coordinador `coordinador`, bajo `@miyura.com`. El login de empresa devuelve también `user.companyId`; úsalo como `ID_EMPRESA_A/B`. Para cada prueba vulnerable, un `200`/`201` con datos o mutación de recurso ajeno confirma el problema; `403` (o `404` para ocultar existencia) es el resultado seguro. Para los controles de rol, `403` al token incorrecto confirma el bloqueo. El seed crea muchas filas; no lo vuelvas a ejecutar en una BD compartida solo para probar.

### P01–P03 — catálogo y creación de empresa global

```powershell
curl.exe -i "$BASE/companies" -H "Authorization: Bearer $student"
curl.exe -i -X POST "$BASE/companies" -H "Authorization: Bearer $companyA" -H 'Content-Type: application/json' -d '{"taxId":"TEST-9001","name":"Empresa prueba","sector":"QA","contactEmail":"qa@example.test"}'
curl.exe -i "$BASE/offers" -H "Authorization: Bearer $student"
```

Esperado: `GET /companies` y `GET /offers` pueden responder `200` como catálogos; el `POST /companies` de COMPANY debe responder `403`. Son accesos globales intencionales, no IDOR.

### P04–P07 — ofertas de otras empresas

```powershell
curl.exe -i "$BASE/offers/ID_BORRADOR_AJENO" -H "Authorization: Bearer $student"
curl.exe -i -X POST "$BASE/offers" -H "Authorization: Bearer $companyA" -H 'Content-Type: application/json' -d '{"companyId":ID_EMPRESA_B,"title":"Prueba IDOR","description":"descartable","modality":"HYBRID","seats":1,"requiredHours":240,"periodStart":"2026-10-01T00:00:00.000Z","periodEnd":"2027-01-01T00:00:00.000Z"}'
curl.exe -i -X PATCH "$BASE/offers/ID_DRAFT_B/publish" -H "Authorization: Bearer $companyA"
curl.exe -i -X PATCH "$BASE/offers/ID_PUBLISHED_B/close" -H "Authorization: Bearer $companyA"
```

Esperado seguro: no devolver un borrador ajeno a un estudiante (404/403); rechazar la creación de COMPANY con `companyId` distinto de la empresa del token; rechazar publicar/cerrar ofertas de B con `403`/`404`. Actual: `GET :id` consulta por ID sin estado; `POST` propaga `companyId` del DTO; `publish`/`close` reciben solo el ID. El `POST` y las mutaciones dejan cambios: hacerlos solo en una base local descartable.

### P08–P09 — postulaciones de ofertas ajenas

**Resultado observado (2026-10-06, P08):** token de `empresa0@miyura.com` (`companyId: 1`) consultó `GET /api/offers/6/applications`; la oferta pertenece a `companyId: 2`. La API respondió `200 OK` e incluyó seis postulaciones con nombre, correo, motivación y estado del estudiante. Hallazgo P08 confirmado. Se omiten los datos personales del cuerpo de respuesta en este informe.

```powershell
curl.exe -i "$BASE/offers/ID_OFERTA_B/applications" -H "Authorization: Bearer $companyA"
curl.exe -i -X PATCH "$BASE/applications/ID_POSTULACION_B/decide" -H "Authorization: Bearer $companyA" -H 'Content-Type: application/json' -d '{"status":"REJECTED"}'
```

Esperado seguro: `403`/`404` cuando la oferta de la postulación no pertenece a A. Actual: el listado busca por `offerId`; la decisión busca por `applicationId` y su oferta, pero no compara `companyId` con A. La segunda llamada cambia datos; usar fixture descartable.

### P10–P12 — acciones globales del coordinador

```powershell
curl.exe -i "$BASE/placements/accreditation?period=2026-2" -H "Authorization: Bearer $companyA"
curl.exe -i -X PATCH "$BASE/placements/ID_PLACEMENT/activate" -H "Authorization: Bearer $student"
```

Esperado: `403` por rol. Para probar P11 (coordinador asigna como tutor a un usuario sin rol TUTOR), toma una postulación ACCEPTED sin placement activo y el ID de un usuario STUDENT:

```powershell
curl.exe -i -X POST "$BASE/placements" -H "Authorization: Bearer $coord" -H 'Content-Type: application/json' -d '{"applicationId":ID_ACEPTADA_SIN_PLACEMENT_ACTIVO,"tutorId":ID_STUDENT}'
```

Esperado seguro: `400`/`403` porque el usuario asignado no es tutor. Actual según el código: se crea el placement con ese `tutorId`, pues no se consulta el rol del usuario; ejecuta solo en base descartable. El acceso del coordinador a placement/acreditación es global intencional (P10/P12).

### P13 — tutor revisa horas de otro tutor

```powershell
curl.exe -i -X PATCH "$BASE/hour-logs/ID_LOG_SUBMITTED_B/review" -H "Authorization: Bearer $tutorA" -H 'Content-Type: application/json' -d '{"status":"REJECTED","note":"prueba de autorización"}'
```

Esperado seguro: `403` si el placement pertenece a tutor B. Actual: el servicio comprueba existencia/estado del hour log y registra `reviewedById`, pero no consulta el tutor asignado. Usar registro SUBMITTED descartable.

### P14 — repetición de idempotencia entre usuarios

```powershell
curl.exe -i -X POST "$BASE/sync/push" -H "Authorization: Bearer $student" -H 'Content-Type: application/json' -d '{"ops":[{"clientOpId":"UUID_CONOCIDO_DE_OTRO_USUARIO","entity":"hourLog","op":"update","baseVersion":1,"payload":{"id":ID_LOG,"hours":1}}]}'
```

Esperado seguro: no revelar ni reutilizar respuesta de operación registrada con otro `userId` (rechazar con conflicto/403). Actual: la búsqueda inicial por `clientOpId` devuelve directamente `existing.response`, sin cotejar dueño. El UUID debe ser conocido; confirmar con dos cuentas y UUID creado previamente por la primera en base local descartable.

### Comprobaciones negativas de las demás rutas sin pertenencia por recurso

**Resultados observados (2026-10-06):** estudiante0 solicitó horas, progreso y evaluaciones del placement de estudiante3 (`placementId: 4`). Las tres respuestas fueron `403 Forbidden`; los controles de pertenencia de las rutas 20, 21 y 24 funcionan. Además, empresa0 envió `POST /api/evaluations` como `COMPANY` para ese placement de otra empresa; respondió `403 Forbidden` con “la empresa solo puede enviar su propia evaluación de tipo COMPANY”. La ruta 23 también bloquea el cruce de empresa.

**Resultados adicionales observados (2026-10-06):** `GET /api/companies` y `GET /api/offers` con token STUDENT respondieron `200` (catálogos generales esperados); `POST /api/companies` con token COMPANY, `GET /api/placements/accreditation` con token COMPANY, `POST /api/placements` con token TUTOR y `PATCH /api/placements/4/activate` con token STUDENT respondieron `403` por rol.

```powershell
curl.exe -i -X POST "$BASE/placements/ID_PLACEMENT/documents" -H "Authorization: Bearer $student" -H 'Content-Type: application/json' -d '{"kind":"AGREEMENT","filename":"probe.pdf","mimeType":"application/pdf","size":1,"storageKey":"probe"}'
curl.exe -i -X POST "$BASE/hour-logs" -H "Authorization: Bearer $companyA" -H 'Content-Type: application/json' -d '{"placementId":ID_PLACEMENT,"date":"2026-10-06","startTime":"08:00","endTime":"09:00","hours":1,"activity":"probe"}'
curl.exe -i "$BASE/placements/ID_PLACEMENT/hour-logs" -H "Authorization: Bearer $companyA"
curl.exe -i "$BASE/placements/ID_PLACEMENT/progress" -H "Authorization: Bearer $companyA"
curl.exe -i -X POST "$BASE/evaluations" -H "Authorization: Bearer $companyA" -H 'Content-Type: application/json' -d '{"placementId":ID_PLACEMENT_AJENO,"kind":"COMPANY","period":"2026-2","scores":{"technical":1,"communication":1,"punctuality":1}}'
curl.exe -i "$BASE/placements/ID_PLACEMENT/evaluations" -H "Authorization: Bearer $companyA"
curl.exe -i "$BASE/sync/pull" -H "Authorization: Bearer $companyA"
```

Interpretación: documento de otro estudiante debe responder `403`; rol incorrecto en `POST /hour-logs` debe dar `403`; un COMPANY ajeno no debe leer horas/progreso/evaluaciones; evaluación `COMPANY` para placement ajeno debe dar `403`; `sync/pull` solo debe incluir registros de placements asignados al usuario (aunque la ruta permita cualquier JWT). La primera prueba de documento solo será negativa si `ID_PLACEMENT` pertenece a otra persona y el estudiante no es coordinador.

## Cobertura frontend

El frontend no declara rutas de servidor: invoca la API desde `src/api/*.ts`, páginas y sincronización offline. La columna de cliente registra esos call sites. Para completar una revisión de UI se deben contrastar el actor de cada pantalla con los roles permitidos aquí; ocultar botones o proteger rutas en React no sustituye la autorización del backend.

## Pendientes para cerrar la épica

1. Ejecutar las pruebas P04–P09 y P13 en una base local descartable y registrar status/cuerpo observado e IDs de fixture.
2. Reproducir P14 creando una operación de sync con cuenta A y repitiendo su UUID con cuenta B.
3. Crear subtareas priorizadas para P04–P07, P08 (si no está cubierto), P14 y P11; vincular las issues existentes E3-02 (#11) y E3-07 (#15) donde correspondan.
4. Actualizar esta tabla con los resultados HTTP reales después de los fixes.
