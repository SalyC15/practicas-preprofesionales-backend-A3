# E6-02 calendar dates
Objective: preserve institutional calendar days across REST, sync and offline UI.
Branch: fix/E6-02-fechas-sin-desfase-tz (from develop in both repos). Delivery: auto-chain / feature-branch-chain; runners: Vitest, pnpm.

## Specs
S1: "La rama debe crearse desde `develop` y llamarse `fix/E6-02-fechas-sin-desfase-tz`." "Todos los commits deben ser pequeños, frecuentes e incluir la clave `E6-02` en el mensaje".
S2: "**PROHIBIDO** editar o desactivar los workflows de GitHub Actions (`.github/workflows/ci.yml`)." "La cobertura de tests **no puede bajar**." "Antes de dar por terminada la tarea, deben pasar sin errores: migraciones, typecheck, linter, tests y build."
S3: "**CA-1:** La fecha se normaliza en el servidor a la zona horaria de la institución, configurable." "**Decisión:** La fecha de un registro de horas (`HourLog.date`) es un **DÍA CALENDARIO** (`YYYY-MM-DD`), **NO un instante de tiempo**." "INSTITUTION_TIMEZONE=America/Guayaquil".
S4: "**CA-2:** Una fecha fuera del rango de la práctica se rechaza con un mensaje que dice cuál es el rango válido." "**CA-3:** No se pueden registrar horas con fecha futura." "No se pueden registrar horas con fecha futura". "La fecha del registro (${dateString}) está fuera del rango válido de la práctica (${placementStartString} a ${placementEndString})."
S5: "**CA-4:** Existen tests con dispositivos en zonas horarias distintas que producen el mismo resultado." "2026-10-13"; "2026-10-13T23:30:00-05:00"; "2026-10-14T04:30:00Z"; "2026-10-14T06:30:00+02:00"; "2026-10-13T00:00:00.000Z"; "2026-10-14T02:00:00Z"; "2026-10-14T01:00:00Z"; "2026-02-30". All boundaries and scenarios in L1 apply.
S6: "**CA-5:** Los registros existentes no cambian de día al desplegar: si hace falta migrarlos, la migración es explícita y reversible."
S7: "La interfaz es *offline-first*: **nunca** hace `fetch` directo de datos sincronizables para mostrarlos; lee y escribe en la base local **Dexie (IndexedDB)** y sincroniza mediante la cola local (`outbox`) hacia `/sync/push` y `/sync/pull`." "Valida que no se ingresen fechas futuras." "Valida que la fecha esté dentro del rango de la práctica (`startDate` a `endDate`) y muestra al usuario el mensaje que indica cuál es el rango válido." "Si una operación offline es rechazada por el servidor en `/sync/push` por fecha inválida, asegúrate de que el motivo devuelto por el servidor sea visible para el estudiante."
S8: "pnpm lint"; "pnpm test"; "pnpm build". "Qué cambia:"; "Migraciones / Datos existentes:"; "Cómo se prueba:"; "Qué queda fuera:".

S9 (latest lint scope): "NO modifiques ni arregles problemas de lint en archivos ajenos a E6-02, porque varios de esos problemas pertenecen a otras historias del backlog (como E6-01, E6-03, E5-02) y causarán conflictos con mi equipo." "Elimina o limpia del directorio de trabajo los artefactos locales como `.yura-ci` (no deben commitearse) y vuelve a correr `pnpm lint` en ambos repositorios." "Si hay errores de lint en los archivos que TÚ creaste o modificaste para E6-02, corrígelos todos." "Muéstrame la salida exacta de `pnpm lint` después de quitar `.yura-ci`, diferenciando cuántos son \"errors\" (que rompen el workflow ci.yml) y cuántos son solo \"warnings\" heredados de la plantilla." "Dime exactamente qué línea debo pegar manualmente en `.env.example` (ya que tienes bloqueada su edición) para yo agregarla a mano antes de hacer el commit final." S9 restricts remediation of inherited lint in S2/S8; preserve unrelated errors and report them.

## Tasks
T1 | S1-S8,S9 | delegated: backend/frontend independent units, disjoint repositories | blocked: manual env-example confirmation before final configuration commit | functional source/proofs committed; backend181tests coverage84.55/83.89/72.83/84.55 and frontend132tests coverage41.15/79.92/80.64/41.15 (statements/branches/functions/lines); original source commits plus scoped fixes459e67d/5b0cf88 recorded; unrelated lint intentionally untouched.
T2 | S2-S8,S9 | delegated: independent verification and parent checks | blocked: manual env-example confirmation for final configuration verification | behavior/HTTP/DB/Dexie proofs, tests, coverage, migrations/typecheck/build verified; scoped lint refactors independently checked; global inherited failures report-only under S9; no production/native-browser claims.
T3 | S1,S2,S8,S9 | inline: review boundaries, delivery notes and PR-ready summary | blocked: manual env confirmation before final configuration commit | source and scoped-lint commits recorded; latest native assessments reviewDue=false/under_budget; no further native review pending for these refactors; global lint not green; no push/PR.
T4 | S1,S2,S9 | delegated: parallel backend/frontend scoped lint units, disjoint repositories | done | local artifacts removed; backend459e67d/frontend5b0cf88; independent49/29focusedtests/typecheck pass; scoped backend0findings/frontend0errors1inheritedwarning; exact global lint20errors33warnings/backend and15errors4warnings/frontend exit1 (unrelated errors untouched); parent HEAD stdin ESLint proves warning18→13.

## Log
L1 — Original user specification (verbatim):

# Especificación Técnica para Agente de IA: Issue E6-02

## 1. Rol y Objetivo
Actúa como un Ingeniero de Software Senior Full-Stack (experto en NestJS, Prisma, PostgreSQL, React, TypeScript y arquitecturas Offline-First con Dexie/IndexedDB). 
Tu objetivo es resolver de punta a punta la historia **E6-02: Guardar las fechas de la práctica sin desfase de zona horaria**, cumpliendo estrictamente todos los criterios de aceptación tanto en el **Backend** como en el **Frontend**.

---

## 2. Reglas Estrictas del Proyecto (No negociables)
1. **Ramas y Commits:**
   - La rama debe crearse desde `develop` y llamarse `fix/E6-02-fechas-sin-desfase-tz`.
   - Todos los commits deben ser pequeños, frecuentes e incluir la clave `E6-02` en el mensaje (ej. `fix(E6-02): normalize hour log dates to institution timezone`).
2. **Integración Continua (CI) y Cobertura:**
   - **PROHIBIDO** editar o desactivar los workflows de GitHub Actions (`.github/workflows/ci.yml`).
   - La cobertura de tests **no puede bajar**. Todo código nuevo debe ir acompañado de sus pruebas en el mismo PR.
   - Antes de dar por terminada la tarea, deben pasar sin errores: migraciones, typecheck, linter, tests y build.
3. **Regla de Oro del Frontend:**
   - La interfaz es *offline-first*: **nunca** hace `fetch` directo de datos sincronizables para mostrarlos; lee y escribe en la base local **Dexie (IndexedDB)** y sincroniza mediante la cola local (`outbox`) hacia `/sync/push` y `/sync/pull`.

---

## 3. Contexto del Problema y Criterios de Aceptación Oficiales

### Historia de Usuario
> *"Como estudiante, quiero que la fecha que registro sea la que queda guardada, para que mis horas no aparezcan en el día equivocado."*

### Contexto
La fecha del registro de horas (`HourLog`) llega desde el dispositivo y se guarda tal cual, sin normalizar. Un teléfono con la hora mal, o simplemente una diferencia horaria o conversión implícita a UTC, hace que el registro caiga en otro día. Tampoco se comprueba que la fecha esté dentro del periodo de la práctica (`Placement`): hoy se pueden registrar horas de antes de empezar o en fechas futuras.

### Criterios de Aceptación (CA)
- **CA-1:** La fecha se normaliza en el servidor a la zona horaria de la institución, configurable.
- **CA-2:** Una fecha fuera del rango de la práctica se rechaza con un mensaje que dice cuál es el rango válido.
- **CA-3:** No se pueden registrar horas con fecha futura.
- **CA-4:** Existen tests con dispositivos en zonas horarias distintas que producen el mismo resultado.
- **CA-5:** Los registros existentes no cambian de día al desplegar: si hace falta migrarlos, la migración es explícita y reversible.

---

## 4. Decisión Arquitectónica: "Día Calendario" vs. "Instante"
Las notas técnicas exigen decidir y documentar si la fecha de un `HourLog` es un **día calendario** o un **instante**:
- **Decisión:** La fecha de un registro de horas (`HourLog.date`) es un **DÍA CALENDARIO** (`YYYY-MM-DD`), **NO un instante de tiempo**. Un estudiante registra que trabajó X horas en una fecha específica (ej. `2026-10-13`), sin importar a qué hora del día llenó el formulario ni en qué zona horaria se encontraba su dispositivo.
- **Representación canónica en Backend/BD:**
  - Si llega una cadena de solo fecha (`"YYYY-MM-DD"`), ese es directamente el día calendario deseado.
  - Si llega un timestamp ISO con hora/offset (ej. `"2026-10-13T22:30:00-05:00"` o `"2026-10-14T03:30:00.000Z"`), el servidor debe convertir ese instante a la **zona horaria de la institución** (ej. `America/Guayaquil`), extraer sus componentes `YYYY-MM-DD` en esa zona horaria, y guardarlo de forma canónica a las `00:00:00.000Z` UTC de ese día calendario (`new Date("YYYY-MM-DDT00:00:00.000Z")`).
  - Al leer o formatear una fecha de `HourLog` o las fechas de rango de `Placement` (`startDate`, `endDate`), se debe extraer siempre la parte `YYYY-MM-DD` en UTC (si están normalizadas a `00:00:00.000Z`) o en la zona horaria institucional, evitando usar métodos dependientes del timezone local del proceso como `.getDate()` sin zona horaria.

---

## 5. Plan de Ejecución Paso a Paso

### FASE 1: Exploración e Inspección del Código (Ejecutar primero)
Antes de modificar archivos, inspecciona el repositorio y responde internamente:
1. Lee `README.md` y `KNOWN_ISSUES.md` (busca menciones a fechas, horas o `HourLog`).
2. En **Backend**:
   - Revisa `prisma/schema.prisma`: ¿Cómo están definidos los campos de fecha en `Placement` (`startDate`, `endDate` o equivalentes) y en `HourLog` (`date` o equivalente)?
   - Revisa `prisma/seed.ts`: ¿Cómo se crean las fechas de `Placement` y `HourLog` en el seed?
   - Busca el módulo de horas (`hour-log`, `hours`, etc.) y el módulo de sincronización (`sync/push`, `sync/pull`). Identifica todos los puntos de entrada donde se crea o actualiza un `HourLog`.
   - Revisa si ya se implementó `E6-01` (unificación de validación de horas) para colocar o integrar ahí la validación de fechas.
3. En **Frontend**:
   - Busca el formulario de registro de horas, el listado del libro de horas y las funciones de formateo de fechas.
   - Revisa cómo se guarda la fecha en Dexie (`IndexedDB`) y cómo se empaqueta el payload en la cola de sincronización (`outbox`).

---

### FASE 2: Implementación en el Backend

#### 2.1. Configuración de la Zona Horaria Institucional (CA-1)
1. Define la variable de entorno `INSTITUTION_TIMEZONE` (o verifica si ya existe un nombre estándar en el proyecto).
2. Agrégala en `.env.example` (ej. `INSTITUTION_TIMEZONE=America/Guayaquil`) y documéntala en el `README.md` si corresponde.
3. En el servicio de configuración de NestJS, lee `process.env.INSTITUTION_TIMEZONE` con un valor por defecto seguro a `America/Guayaquil` para no romper entornos de CI si no está declarada, permitiendo que sea 100% configurable por entorno o inyección en los tests.

#### 2.2. Utilidad de Normalización y Comparación de Fechas (CA-1, CA-3)
Crea una utilidad pura y bien testeada (ej. `date-normalization.util.ts` o dentro del validador unificado de horas) usando `Intl.DateTimeFormat` nativo de Node 24 (o la librería de fechas que ya exista en `package.json`, sin añadir dependencias innecesarias):
1. **`normalizeToInstitutionCalendarDate(input: string | Date, timeZone: string): { dateString: string; utcMidnight: Date }`:**
   - Si `input` es un string con formato exacto `/^\d{4}-\d{2}-\d{2}$/`:
     - Valida que sea una fecha real de calendario (ej. rechazar `2026-02-30`).
     - Devuelve `dateString: input` y `utcMidnight: new Date(`${input}T00:00:00.000Z`)`.
   - Si `input` es un `Date` o un string ISO con tiempo/zona horaria (ej. `2026-10-13T23:15:00-05:00` o `2026-10-14T04:15:00.000Z`):
     - Usa `Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })` para obtener el `YYYY-MM-DD` exacto en la zona horaria de la institución (`timeZone`).
     - Devuelve `dateString: "YYYY-MM-DD"` y `utcMidnight: new Date(`${dateString}T00:00:00.000Z`)`.
2. **`getCurrentDateInInstitutionTz(timeZone: string, now: Date = new Date()): string`:**
   - Devuelve el día actual `"YYYY-MM-DD"` en la zona horaria de la institución.

#### 2.3. Reglas de Validación de Fecha de Práctica (CA-2, CA-3)
Al crear o editar un registro de horas (`HourLog`), tanto por endpoint REST directo como por sincronización offline (`/sync/push`):
1. Normaliza la fecha recibida usando la zona horaria de la institución configurada.
2. **Validación de Fecha Futura (CA-3):**
   - Compara lexicográficamente el `dateString` (`YYYY-MM-DD`) del registro contra `todayString` (`YYYY-MM-DD` actual en la zona horaria de la institución).
   - Si `dateString > todayString`, lanza un error de validación (`BadRequestException` / rechazo de operación en sync) con un mensaje claro (ej. `"No se pueden registrar horas con fecha futura"`).
3. **Validación de Rango de la Práctica (CA-2):**
   - Obtén el `Placement` asociado al registro de horas (incluyendo su fecha de inicio `startDate` y fecha de fin `endDate`).
   - Obtén la representación `YYYY-MM-DD` de `startDate` y `endDate`.
   - Si `dateString < placementStartString` (o si existe `endDate` y `dateString > placementEndString`):
     - Rechaza el registro con un mensaje descriptivo que **incluya explícitamente el rango válido**.
     - Ejemplo de mensaje: `"La fecha del registro (${dateString}) está fuera del rango válido de la práctica (${placementStartString} a ${placementEndString})."` (Si la práctica aún no tiene fecha de fin definida, indícalo claramente mostrando desde qué fecha es válido).
4. Guarda en la base de datos el `utcMidnight` normalizado (`YYYY-MM-DDT00:00:00.000Z`).

#### 2.4. Revisión de Registros Existentes y Migración (CA-5)
1. Revisa cómo están almacenadas las fechas actuales en la base de datos y en `prisma/seed.ts`.
2. Si los registros existentes o del seed tienen horas distintas de `00:00:00.000Z` que pudieran cambiar de día al interpretarse, o si es necesario normalizar las filas existentes:
   - Crea una migración de Prisma explícita que normalice las fechas existentes a la medianoche UTC del día correspondiente en la zona horaria institucional sin que ningún registro cambie de día.
   - Documenta o incluye el script SQL de *down/rollback* para garantizar que la migración sea **explícita y reversible**.
   - Si el esquema actual ya usa `DateTime` y los datos del seed ya están en `00:00:00.000Z`, verifica y garantiza mediante un test o script que ningún registro existente cambie de día al desplegar.

---

### FASE 3: Implementación en el Frontend

1. **Inspección del Formulario y Formateo de Fechas:**
   - En JavaScript/TypeScript de navegador, hacer `new Date("2026-10-13")` interpreta la fecha en UTC (`00:00:00Z`), pero al mostrarla con `.toLocaleDateString()` sin `timeZone: 'UTC'` en América Latina (UTC-5), el navegador muestra el día anterior (`2026-10-12` a las 19:00).
   - De igual forma, hacer `new Date()` a partir de un input local y enviarlo sin normalizar causa desfases.
2. **Correcciones requeridas en el Frontend:**
   - **Al guardar desde el `<input type="date">`:** Conserva y envía la fecha como día calendario (`"YYYY-MM-DD"`) o normalízala sin que la zona horaria del navegador la desplace al día anterior/siguiente cuando se guarda en Dexie y se encola en `outbox`.
   - **Al renderizar fechas en el Libro de Horas:** Asegúrate de formatear la fecha extrayendo la parte `YYYY-MM-DD` o usando `timeZone: 'UTC'` al formatear fechas que vienen a las `00:00:00.000Z`, para que el día mostrado en pantalla sea exactamente el mismo día calendario guardado.
   - **Validación en el Formulario (alineado con E6-01):**
     - Valida que no se ingresen fechas futuras.
     - Valida que la fecha esté dentro del rango de la práctica (`startDate` a `endDate`) y muestra al usuario el mensaje que indica cuál es el rango válido.
     - Si una operación offline es rechazada por el servidor en `/sync/push` por fecha inválida, asegúrate de que el motivo devuelto por el servidor sea visible para el estudiante.

---

### FASE 4: Suite de Pruebas Automatizadas (Obligatorio)

Añade pruebas unitarias y de integración en el Backend (y Frontend donde aplique) que cubran los siguientes escenarios:

1. **Dispositivos en distintas zonas horarias (CA-4):**
   - Envía registros correspondientes al mismo día institucional desde distintos offsets/formatos simulando dispositivos en diferentes zonas horarias, por ejemplo:
     - Dispositivo enviando fecha pura: `"2026-10-13"`
     - Dispositivo en Ecuador (UTC-5) a última hora de la noche: `"2026-10-13T23:30:00-05:00"`
     - Dispositivo con reloj en UTC para ese mismo instante: `"2026-10-14T04:30:00Z"`
     - Dispositivo en Madrid (UTC+2) para ese mismo instante: `"2026-10-14T06:30:00+02:00"`
     - Dispositivo en Tokio (UTC+9) enviando una fecha local dentro del mismo día institucional.
   - **Resultado esperado:** Todos los casos anteriores se normalizan y guardan exactamente con la misma fecha calendario (`2026-10-13T00:00:00.000Z`) cuando `INSTITUTION_TIMEZONE=America/Guayaquil`.
2. **Configurabilidad de la zona horaria (CA-1):**
   - Un test que cambie la configuración de `INSTITUTION_TIMEZONE` (por ejemplo, de `America/Guayaquil` a `UTC` o `Europe/Madrid`) y demuestre que un instante de borde (ej. `2026-10-14T02:00:00Z`) se normaliza a `2026-10-13` en Guayaquil pero a `2026-10-14` en Madrid.
3. **Rechazo por fecha fuera del rango de la práctica (CA-2):**
   - Test registrando una hora 1 día **antes** de `placement.startDate` -> Debe fallar (400 / rechazado) y el mensaje de error debe contener explícitamente las fechas de inicio y fin válidas del `Placement`.
   - Test registrando una hora 1 día **después** de `placement.endDate` -> Debe fallar y el mensaje debe contener el rango válido.
   - Test en los bordes exactos (`startDate` y `endDate`) -> Deben ser aceptados.
4. **Rechazo por fecha futura (CA-3):**
   - Test intentando registrar horas con fecha de mañana (respecto a la zona horaria institucional) -> Debe ser rechazado.
   - Test de borde horario: Cuando en UTC ya es el día siguiente (ej. `2026-10-14T01:00:00Z`), pero en la institución (`America/Guayaquil`, UTC-5) todavía es `2026-10-13T20:00:00-05:00`, intentar registrar el `2026-10-14` debe rechazarse como fecha futura, mientras que `2026-10-13` debe permitirse.
5. **No regresión en registros existentes (CA-5):**
   - Test que verifique que los registros cargados previamente no cambian de día al ser leídos o tras correr las migraciones.

---

### FASE 5: Verificación Final y Resumen para el PR

Antes de finalizar tu trabajo, ejecuta en consola:
```bash
pnpm lint
pnpm test
pnpm build
```
Si todos los comandos terminan en verde, entrégame un resumen listo para pegar en la descripción del Pull Request que incluya:
1. **Qué cambia:** Explicación de la decisión técnica ("Día calendario" vs "Instante") y cómo se configuró `INSTITUTION_TIMEZONE`.
2. **Migraciones / Datos existentes:** Explicación de por qué los registros existentes no cambian de día (y cómo revertir la migración si se creó alguna).
3. **Cómo se prueba:** Comandos para ejecutar los tests nuevos y pasos para demostrarlo manualmente en la review del sprint.
4. **Qué queda fuera:** Cualquier alcance que pertenezca a otras historias de la épica E6.

L2 — User delivery choice: "Cadena sobre rama de la historia (recomendado)" (`feature-branch-chain`). Forecast: backend 600-900 changed lines, frontend 400-700, tests included. No publishing authorized. Each work-unit commit will define a proposed review slice on the requested feature branch; do not create extra remote branches or PRs.
L21 — Frontend independent scoped checks passed29tests/typecheck and0lint errors/1warning. Warning-lineage concern resolved by parent fullHEAD-relative diff + baseline ESLint over HEAD source via stdin (no file writes): original HourLogForm complexity18warning, current13warning, same function/rule; no new warning. Parent diff confirms onlyHourLogForm.tsx/spec changed; row/outbox transaction and payload mapping retained. Committed5b0cf88 with --only sourcepaths; frontend clean. Postcommitassessmentmedium, fallbackbias independentrequirement satisfied,reviewDuefalseunder_budget. T4 done with observed outcomes/checks/work-unitcommits; T1/T2/T3 blocked only on manual env confirmation/final configuration, not remediation of unrelated backlog files. Exact final lint logs remain local in each .git/e6-02-verification (20errors33warnings/backend;15errors4warnings/frontend). No default DB migrations, no workflow/rule suppression, no push/PR, no full-green lint claim.

L20 — Backend independent scoped verifier passed49tests/ESLint0/typecheck0; parent additionally inspected fullHEAD-relative source diff and confirms onlyHourLogService/SyncService lintrefactor, no cap/messages/atomicguards/idempotence changes. Committed459e67d (261diff lines). Postcommitassess nativeRiskmedium, concurrency escalationhigh,reviewDuefalseunder_budget; independent verification already satisfied, no outsideview ritual. Protected env sample and tasklog remainunstaged. Frontend scoped verifierstillactive.

L19 — Frontend T4 worker completed only HourLogForm.tsx/spec: shared same-filevalidation/presentation, preserved8hourcap and offlinecontract. Focused29/full132 tests pass; typecheck/buildpass; coverage41.15statements/lines79.92branches80.64functions(allup). Scopedlint0errors1inheritedcomplexitywarning. Nativeassessmedium/fallbackwriterprofilebiasrequiresindependent verifier; reviewDue=falseunder_budget. Independentfrontendverifier mv7dmkqv-f-g7sr active. Parent exactfinalfrontendlint saved only .git/e6-02-verification/frontend-lint-final.txt; original auth/otherpageerrors untouched. Final env examples both modified outside allowedsurfaces, never read/staged byworkers orparent.

L18 — Parent final backend pnpm lint exit1: exact footer 53 problems (20errors,33warnings), all remaining diagnostics in unrelated auth/accreditation files. Only expected source lint changes in HourLogService/SyncService. Protected .env.example now appears modified in git status (not changed by bounded workers/parent); preserve it without read/stage/commit pending human confirmation. Independent backend scoped verifier mv7dl79k-e-otaf active; frontend writer still active. No task marked complete without observed proof.

L17 — Backend T4 worker completed only src/hour-log/hour-log.service.ts and src/sync/sync.service.ts. Scoped ESLint exit0/no output; focused47 tests before/after pass; isolated full181 pass; coverage84.55 statements/lines83.89branches72.83functions (all improved). Unprefixed tests hit known default DB cup-trigger drift and failed180/181; isolated authoritative proof passes, no default DB mutation/migration. Native assess now succeeds after artifact cleanup: nativeRisk medium, agent escalated concurrency tohigh, independent verifier required; reviewDue=false/under_budget, so no new native review started. Parent final global lint output saved .git/e6-02-verification/backend-lint-final.txt; inherited files remain untouched. Frontend worker still running.

L16 — User-authorized cleanup removed frontend .yura-ci (1.1GB) and backend generated .codegraph (3MB); neither tracked. Post-cleanup lint: backend23 errors/34 warnings, frontend17 errors/4warnings, each exit1. Relevant surfaces only: backend src/hour-log/hour-log.service.ts (todo-tag), src/sync/sync.service.ts (cognitive-complexity/nested conditional); frontend src/components/HourLogForm.tsx (identical functions/cognitive-complexity). Other files untouched. Read-only command incident: one intended frontend lint accidentally ran backend again; no mutation, then corrected with explicit frontend cwd. Mirror comparison resolved: Engram trims only the final newline; all content matches after trimEnd, no intent conflict or lost content. Exact before-fix lint outputs saved only in each repo .git/e6-02-verification, never staged.

L15 — User correction (verbatim):
NO modifiques ni arregles problemas de lint en archivos ajenos a E6-02, porque varios de esos problemas pertenecen a otras historias del backlog (como E6-01, E6-03, E5-02) y causarán conflictos con mi equipo.

Haz únicamente lo siguiente:
1. Elimina o limpia del directorio de trabajo los artefactos locales como `.yura-ci` (no deben commitearse) y vuelve a correr `pnpm lint` en ambos repositorios.
2. Si hay errores de lint en los archivos que TÚ creaste o modificaste para E6-02, corrígelos todos.
3. Muéstrame la salida exacta de `pnpm lint` después de quitar `.yura-ci`, diferenciando cuántos son "errors" (que rompen el workflow ci.yml) y cuántos son solo "warnings" heredados de la plantilla.
4. Dime exactamente qué línea debo pegar manualmente en `.env.example` (ya que tienes bloqueada su edición) para yo agregarla a mano antes de hacer el commit final.

L14 — All functional source committed. Proposed feature-branch-chain slices: backend 0a9f045 utilities/config (275 lines), ec96bba REST (265), 4a19f0f sync (284), 002d9b3 HTTP fixture/proofs (528, honest cohesive oversized test slice), b5f8a24 seed/audit/docs (96); frontend c262c33 utilities (210), 94d0f4a form (255), 54f9e2f ledger/docs (100). No remote branches or PRs created. Parent final coverage artifacts confirm backend84.02/83.47/71.05/84.02 and frontend41.10/79.13/80.39/41.10. Workflows unchanged in both develop diffs; whitespace check passes. Review inspect was ready after explicit untracked exclude; committed-only START then refused native-start-retained-selection-candidate-mismatch, mutation_performed=false, no lineage/approval created. Native review unavailable for attempted backend utility candidate; never infer closure or apply it to other candidates. All tasks now blocked on named human decisions: inherited lint remediation scope, manual protected env example additions, review-tool disposition. Native browser runner absent; jsdom proof present. Production audit outside authorized local data, not claimed. Risk: item 3 (shared date consumers/persistence contracts); independent verification and bounded rechecks observed.

L13 — Both limited independent rechecks passed. Backend public HTTP/persistence/replay/null-end proof gaps resolved. Frontend optional-end helper and exact legacy parser behavior resolved; actual schema requires endDate, no optional-end schema migration needed. JSdom/fake IndexedDB is functional UI proof, native browser proof unavailable. Utility work-unit commits created: backend 0a9f045 (275 added lines), frontend c262c33 (207 additions/3 deletions). Post-commit native assess (committedOnly/develop) still fails closed on undeclared untracked paths; no approval inferred. T1/T2 remain blocked on human disposition for known gates, T3 now active committing/review scope. No full green claim.

L12 — Backend correction returned: added HTTP integration with real JWT/ValidationPipe, persisted date/row/version and rejected sync replay assertions; null-end utility case. No production behavior changes. Focused 20 tests and full 181 tests pass; coverage statements/lines84.02,branches83.47,functions71.05. Typecheck/build/new-test ESLint pass; inherited 23 errors remain. Limited independent recheck mv7co0fw-a-q6r1 active; no new full sweep. Environment example remains denied.

L11 — Frontend independent verify confirms Dexie/outbox and rejection rendering; bounded correction dispatched for optional-end helper and restoring original parseLocalDate malformed-date rollover semantics for nine unrelated consumers. Backend schema endDate remains non-null; no schema/Dexie migration. Real browser runner unavailable; jsdom functional proof available, native browser proof unavailable. No install/retry initiated. Frontend corrected baseline coverage comparison already observed by writer; final correction comparison pending.

L10 — Parent seam job-3 exit 0: actual candidate migrations and full suites pass on fresh isolated DB (175 backend / 126 frontend). Backend independent verifier confirms config/date behavior, typecheck/build/schema/deploy; identified missing HTTP ValidationPipe + real-row/version rejection proof and null-end helper test (schema endDate non-null). One correction batch mv7ccr5u-8-7im0 adds those integration probes with unique fixtures in isolated final DB. Documentation changes during verify are parent-authored progress updates, not unexplained mutations. Known lint/env gaps remain and cannot be marked complete.

L9 — Parent final seam job-3 launched: fresh test-only database, actual candidate pnpm db:deploy and pnpm test; frontend full pnpm test with documented Node26 webstorage compatibility flag. No shared test database concurrency. Results pending. Independent per-unit verifiers still running. No workflow/dependency modifications or source commits yet.

L8 — Frontend worker source/self-verification complete: 126 tests pass with NODE_OPTIONS=--no-experimental-webstorage on Node26; corrected baseline 101 tests. Coverage increases: statements/lines 27.23→41.01%, branches 76.05→79.13%, functions 73.33→80.26%. Typecheck/build pass; lint unchanged 10,718 issues (generated .yura-ci and pre-existing source). Env example remains blocked. Frontend native assess unassessable due undeclared untracked scope; high independent verifier mv7ca6ye-7-gaiz running. T1 remains blocked, not done, pending human resolution of environment-example/lint requirements; T2 is active proof of implemented source.

L7 — Backend writer returned partial only for known lint/.env.example requirements. Source contract implemented; typecheck/test/coverage/build and diff whitespace pass. Read-only existing-data audit (pnpm exec tsx prisma/calendar-date-audit.ts) exit 0: 4000 HourLog rows and 400 Placement date fields, zero non-midnight values. No migration/backfill required for inspected local data; production state not inferred. Independent backend verifier mv7c54sb-6-zb97 now running; native assess unassessable due undeclared untracked scope, so high verification applied. Frontend worker remains pending completion.

L6 — Isolated migrated database proves backend baseline 130/130 tests pass; coverage lines/statements 74.84%, functions 57.35%, branches 79.40%. Initial cup trigger failure was shared DB migration drift, not code failure. Job-2 exit 0; Vitest root config resolved source cwd before any source edits (clean develop source). Frontend baseline failed 56/101 tests with localStorage undefined on Node26; lint 10,718 issues includes generated .yura-ci; worker now resumes safe scope, investigates supported no-experimental-webstorage flag, no generated-file deletion or setup bypass. Both .env.example files denied and remain untouched.

L5 — Isolated baseline tooling incident: job-1 failed before migrations because pnpm rejected the scratch node_modules symlink; root dependencies and source untouched. Diagnosed target paths and fresh database existence. Job-2 uses installed Prisma/Vitest runners directly (no installer) against the same isolated database and develop archive; results pending.

L4 — Baseline backend worker: pnpm test:cov exit 1 (129/130, existing application.overbooking trigger test); pnpm lint exit 1 (23 errors, 34 warnings). Guard denied .env.example; parent instructed no bypass, proceed accessible scope and report missing requirement. Frontend launch required cross-repository consent and delayed the nominal parallel launch; backend now resumed alongside frontend. Independent baseline migrations/coverage job-1 uses a fresh PostgreSQL database and develop archive under .git/e6-02-verification/base, never user data.

L3 — Exploration: no E6-01 implementation found. Do not unify unrelated hour caps or refactor deliberate debt. Schema remains DateTime/TIMESTAMP(3); do not reinterpret or rewrite stored dates on reads. Legacy day contract uses UTC date components, preserving current export/list semantics. Audit non-midnight rows and document explicit reversible migration only if evidence requires it; no implicit deployment backfill. For offline client checks use VITE_INSTITUTION_TIMEZONE (default America/Guayaquil), aligned with server INSTITUTION_TIMEZONE; server is authoritative. No new fetch path. Backend base 55180a6; frontend base ceab737. Both branches created clean from develop.
