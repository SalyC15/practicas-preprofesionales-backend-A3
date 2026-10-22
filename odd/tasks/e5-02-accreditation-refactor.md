# E5-02 — Refactor de `calculateAccreditationStatus` + integración main→develop

Refactoriza la decisión de acreditación como reglas ordenadas y legibles, conservando exactamente el comportamiento actual, e integra `main` en `develop` sin perder E5-01.

## Specs

S1 (issue E5-02, backend #41): "Todos los tests de E5-01 siguen pasando sin modificarlos. Ese es el criterio central: si tienes que tocar un test, cambiaste el comportamiento."

S2 (issue E5-02): "El linter ya no marca la función por complejidad."

S3 (issue E5-02): "Las reglas se leen como reglas: alguien de coordinación debería poder revisarlas y entenderlas."

S4 (issue E5-02): "Añadir una regla nueva no obliga a tocar las existentes."

S5 (issue E5-02): "El PR explica la estructura elegida y por qué."

S6 (pedido del usuario): "Conserva exactamente los cuatro resultados posibles, la prioridad de las reglas, los mensajes y su orden, el cálculo del porcentaje y el contrato público."

S7 (pedido del usuario): "**No modifiques `accreditation.spec.ts`**: los 16 tests de caracterización de E5-01 deben continuar pasando sin cambios."

S8 (pedido del usuario): "Elimina la advertencia de complejidad del linter sin desactivar reglas de ESLint. La estructura debe permitir añadir reglas sin modificar la lógica de las existentes."

S9 (pedido del usuario, integración): "Prepara la integración de `main` hacia `develop` en ambos repositorios mediante PR. Resuelve conflictos sin perder cambios y valida la integración antes de continuar." / "No sobrescribas ramas, no uses `force push` y no modifiques directamente `main`." / "Backend: las ramas divergieron; `develop` contiene E5-01 (PR #43), que debe conservarse."

S10 (pedido del usuario, validación): "Ejecuta los tests correspondientes, cobertura, typecheck, lint y build. No modifiques workflows ni funcionalidades ajenas a estas historias." / "Crea un PR independiente por issue contra `develop`, indicando cambios, pruebas, cobertura y decisiones técnicas. Documenta cualquier problema preexistente sin ocultarlo ni alterar los tests para hacerlo pasar."

## Tasks

T1 | S9,S10 | inline: integración main→develop | done | rama `chore/integrate-main-into-develop` (merge e8aa8e1) → PR #44 MERGED (67372a1); 224 tests verdes en base aislada e5_02_int_1792632747 migrada; typecheck y build OK; E5-01 intacto; lint 20→21 errors (el +1 de main, documentado)
T2 | S1-S8 | delegated writer: refactor de `src/placement/accreditation.ts` a reglas ordenadas; `accreditation.spec.ts` intacto; actualizar `KNOWN_ISSUES.md` (D-05) | done | worker mvivj3j6-2-j3ki: 10 reglas `{ id, cuando, decidir }` en `REGLAS_DE_ACREDITACION` + 3 predicados de dominio + orquestador thin; `docs/E5-02-reglas-acreditacion.md` nuevo; D-05 marcada como pagada; commits 2d42f67 (refactor) y 47ec033 (seguimiento)
T3 | S1-S8,S10 | inline: verificación independiente del refactor, evidencia de lint 0 en el archivo, cobertura y typecheck, PR independiente con explicación de estructura | done | verificación del padre: 16/16 de caracterización con el spec byte a byte intacto, eslint del archivo 0 hallazgos (6 antes), suite 224/224, typecheck y build OK, differential propio de 40.000 casos con 0 diferencias; PR #45 abierto contra develop

## Log

L1 — Petición original del usuario (verbatim):

Implementa las issues **E6-06 (frontend #19)** y **E5-02 (backend #41)** en los repositorios `SalyC15/practicas-preprofesionales-frontend-A3` y `SalyC15/practicas-preprofesionales-backend-A3`.

### 1. Sincronización previa de ramas

Antes de implementar, revisa los cambios entre `main` y `develop`:

- Frontend: `main` está 10 commits por delante.
- Backend: las ramas divergieron; `develop` contiene E5-01 (PR #43), que debe conservarse.
- Prepara la integración de `main` hacia `develop` en ambos repositorios mediante PR. Resuelve conflictos sin perder cambios y valida la integración antes de continuar.
- No sobrescribas ramas, no uses `force push` y no modifiques directamente `main`.
- Trabaja cada issue en su propia rama, creada desde el `develop` actualizado.

### 3. E5-02 — Refactorización de acreditación (backend)

Refactoriza `calculateAccreditationStatus` en `src/placement/accreditation.ts` mediante reglas de decisión independientes, ordenadas y legibles.

Conserva exactamente los cuatro resultados posibles, la prioridad de las reglas, los mensajes y su orden, el cálculo del porcentaje y el contrato público.

**No modifiques `accreditation.spec.ts`**: los 16 tests de caracterización de E5-01 deben continuar pasando sin cambios.

Elimina la advertencia de complejidad del linter sin desactivar reglas de ESLint. La estructura debe permitir añadir reglas sin modificar la lógica de las existentes.

L2 — Estado inicial verificado (2026-10-22): `develop` local = `origin/develop` = 2fb4703, worktree limpio. `origin/main` = 58f3aee, 3 commits por delante; `develop` 2 por delante (E5-01: 303a67b + merge 2fb4703). `git merge-tree --write-tree origin/main origin/develop` no reporta conflictos. `main` no toca `src/placement/accreditation.ts` ni `accreditation.spec.ts`: E5-01 queda intacto tras la fusión, pero `main` sí cambia `src/placement/placement.service.ts` (+98) y `src/sync/sync.service.ts` (+18), donde vive parte del trabajo de E6-02 — la fusión se valida contra la suite completa, no solo contra los tests de acreditación.

L3 — Integración resuelta y verificada (2026-10-22). `git merge-tree --write-tree origin/main origin/develop` no reportó conflictos: el merge fue limpio y E5-01 quedó intacto (`git diff origin/develop -- src/placement/accreditation.spec.ts docs/E5-01-reglas-acreditacion.md` → vacío). La suite sobre `develop` dio 223 tests en 27 archivos; tras integrar `main`, 224 en 27 archivos, todos verdes en la base aislada e5_02_int_1792632747 (5 migraciones aplicadas), con typecheck y build en verde. La CI remota del PR #44 dio build SUCCESS en los dos jobs y Yura SUCCESS. PR #44 mergeado a `develop` (67372a1).

Deuda heredada de `main`, documentada y NO corregida: `src/placement/placement.service.ts:97` → `sonarjs/cognitive-complexity` 16 (límite 15), un error nuevo que `main` introduce y que el paso `lint:report` de CI no bloquea (continue-on-error). No lo corrijo porque no pertenece a E5-02 y el contrato público de `calculateAccreditationStatus` no cambia, así que el consumidor no necesita ajustes. Base para el trabajo de la issue: e5_02_issue_1792633111 (migrada).

L4 — T2 implementada (2026-10-22). `src/placement/accreditation.ts` pasa de `if` anidados (complejidad 17, complejidad cognitiva 84, un dead store y tres asignaciones redundantes) a una lista ORDENADA de reglas independientes `{ id, cuando, decidir }`: gana la primera que aplica y el orden de la lista ES la prioridad. `calculateAccreditationStatus` queda como orquestador thin (calcula el porcentaje, busca la primera regla que aplica y arma el resultado). `accreditation.spec.ts` NO se tocó (`git diff --stat src/placement/accreditation.spec.ts` → vacío): los 16 tests de caracterización de E5-01 pasan sin cambios. Equivalencia verificada además con un differential contra la implementación original sobre 24.000 combinaciones de entradas (incluidos `requiredHours` 0, notas `NaN` y todos los estados): 0 diferencias de nivel, motivos y porcentaje. ESLint del archivo: 0 hallazgos, sin desactivar reglas ni tocar `eslint.config.mjs`. typecheck, suite completa (224 tests en 27 archivos) y build en verde sobre la base aislada `e5_02_issue_1792633111`. Documentación: D-05 de `KNOWN_ISSUES.md` marcada como pagada y `docs/E5-02-reglas-acreditacion.md` con la estructura elegida, las reglas en orden y cómo agregar una nueva.

L4 — T2 implementado y verificado por el padre (2026-10-22). El worker mvivj3j6-2-j3ki reescribió `src/placement/accreditation.ts`: la decisión pasó de `if` anidados a seis niveles a una lista `REGLAS_DE_ACREDITACION` de diez entradas `{ id, cuando, decidir }` donde gana la primera que aplica y el orden de la lista ES la prioridad, más tres predicados de dominio (`horasCompletas`, `tutorAprobado`, `empresaAprobada`) y un orquestador thin. `KNOWN_ISSUES.md` actualizó D-05 como pagada y se creó `docs/E5-02-reglas-acreditacion.md` con la estructura elegida, la tabla de las diez reglas y el procedimiento para agregar una regla nueva.

L5 — Verificación del padre, independiente del worker (2026-10-22). `git diff --stat origin/develop -- src/placement/accreditation.spec.ts` → vacío: los 16 tests de caracterización de E5-01 pasan sin tocar el archivo (`pnpm exec vitest run src/placement/accreditation.spec.ts` → 16 passed). `pnpm exec eslint src/placement/accreditation.ts` → 0 hallazgos; en `origin/develop` el mismo archivo tenía 6 (warning complexity 17, error sonarjs/cognitive-complexity 84, error sonarjs/no-dead-store y 3 errores sonarjs/no-redundant-assignments). Medición del delta sobre el repo completo: base `origin/develop` = 54 problemas (21 errors, 33 warnings); con el refactor = 48 problemas (16 errors, 32 warnings); es decir -5 errors y -1 warning, sin desactivar reglas y con `eslint.config.mjs`, los workflows, `placement.service.ts` y `accreditation.service.ts` intactos. `pnpm typecheck` exit 0, `pnpm test` → 224 en 27 archivos, `pnpm build` exit 0, sobre la base aislada e5_02_issue_1792633111 migrada.

Equivalencia de comportamiento probada por el padre con un differential propio (script en `.git/e5-02-verification/differential.ts`, no commiteado): la función nueva contra la implementación original copiada literal de `origin/develop`, sobre una grilla de 40.000 entradas (5 estados × requiredHours {0,240} × approvedHours {0,120,240,300,NaN} × pendingHours {0,8,40,NaN} × 8 combinaciones de convenio/seguro/informe × notas de tutor y empresa {null,2.9,3,4.5,NaN}), comparando nivel, `reasons` con JSON sensible al orden y `completionPercentage` con `Object.is`: `casos=40000 diferencias=0`. Quedan confirmados los detalles que la caracterización fija: el porcentaje conserva el NaN con requiredHours 0, `!(a >= b)` no se "mejora" a `a < b` con NaN, la regla de evaluación del tutor baja sigue emitiendo los dos motivos, y las horas pendientes se distinguen entre `sin revisar` y `de aprobación` sin reportarse en suspendido ni en falta de convenio.

Commits: 2d42f67 (refactor + doc + KNOWN_ISSUES) y 47ec033 (este documento de seguimiento). PR #45 abierto contra `develop`.

L6 — CI remota del PR #45 (2026-10-22): los dos jobs `build` en SUCCESS, `quality / Yura — New Code Quality` en SUCCESS, `yura/new-code-report` NEUTRAL (informe, no puerta) y `branch-state` SKIPPED. `mergeStateStatus: CLEAN`, `mergeable: MERGEABLE`, estado OPEN. El merge queda para la persona que revisa.
