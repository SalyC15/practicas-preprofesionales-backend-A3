# Traspaso Técnico E3-03: Expiración de Sesión y Renovación Atómica (Backend)

Este documento sintetiza el estado técnico, evidencias de verificación, contratos de interfaz, dependencias de integración y propuesta de entrega para la funcionalidad de expiración de sesión y renovación atómica (E3-03) en el repositorio backend.

## 1. Resumen Ejecutivo y Procedencia de Criterios
- **Estado de la funcionalidad**: Implementación completa y verificada localmente sin regresiones de comportamiento.
- **Rama actual de trabajo**: `feat/e3-03-session-expiration` (base: `5411f79`).
- **Rama de integración destino según política**: `develop` (conforme a `.github/PULL_REQUEST_TEMPLATE.md`).
- **Procedencia de criterios de aceptación**: Los criterios de aceptación documentados en este traspaso son autónomos y provienen del registro de trabajo técnico interno (`ProyectoYUNA/odd/tasks/e3-03-session-expiration.md`), el cual reside en la raíz exterior del proyecto fuera de este repositorio Git y se encuentra excluido del control de versiones. Se señala explícitamente que no se ha localizado un issue externo formal independiente con aprobación del cliente o producto; la verificación certifica el cumplimiento frente a los criterios acordados por el equipo técnico.
- **Acciones Git realizadas**: Cero commits, cero cambios en staging, cero alteraciones de ramas o tags. Árbol de trabajo preservado íntegro.

## 2. Mapa de Archivos de la Funcionalidad (Allowlist de Entrega)
Los cambios abarcan 20 archivos exclusivos del dominio de autenticación, modelo de datos y documentación:

| Archivo | Estado Git | Líneas (+) | Líneas (-) | Total | Propósito |
|---|---|---|---|---|---|
| `README.md` | Modificado | 3 | 1 | 4 | Actualización de documentación general del backend. |
| `prisma/schema.prisma` | Modificado | 18 | 0 | 18 | Modelo `AuthSession` con `@@map("auth_sessions")` y relación en cascada. |
| `prisma/migrations/20261005000000_add_auth_session/migration.sql` | Sin seguimiento | 20 | 0 | 20 | DDL de tabla `auth_sessions`, índices y restricción de FK con CASCADE doble. |
| `src/auth/auth.constants.ts` | Sin seguimiento | 12 | 0 | 12 | Constantes de configuración TTL, prefijos y límites de cookies. |
| `src/auth/auth.config.ts` | Sin seguimiento | 70 | 0 | 70 | Validación de variables de entorno (`JWT_SECRET`, TTLs, CORS, producción). |
| `src/auth/auth.config.spec.ts` | Sin seguimiento | 57 | 0 | 57 | Pruebas de validación estricta de variables de entorno y fallback inseguro. |
| `src/auth/auth.controller.ts` | Modificado | 160 | 3 | 163 | Endpoints `/api/auth/{login,refresh,logout}`, cabeceras Origin/Referer y cookies. |
| `src/auth/auth.controller.spec.ts` | Sin seguimiento | 280 | 0 | 280 | Pruebas de integración del controlador y validación de orígenes. |
| `src/auth/auth.module.ts` | Modificado | 8 | 3 | 11 | Registro asíncrono de `JwtModule` consumiendo `AuthConfig`. |
| `src/auth/auth.service.ts` | Modificado | 271 | 6 | 277 | Lógica atómica CAS, emisión de tokens, hash SHA-256 y poda por posesión. |
| `src/auth/auth.service.spec.ts` | Modificado | 500 | 28 | 528 | Pruebas de ciclo de vida, rotación, replays concurrentes y logout. |
| `src/auth/guards/jwt-auth.guard.ts` | Modificado | 38 | 3 | 41 | Guard de autenticación con verificación criptográfica y chequeo en DB. |
| `src/auth/guards/jwt-auth.guard.spec.ts` | Sin seguimiento | 198 | 0 | 198 | Pruebas unitarias de guard y rechazo de tokens vencidos o de generaciones previas. |
| `src/auth/types/auth.types.ts` | Sin seguimiento | 34 | 0 | 34 | Tipos de retorno de autenticación y opciones de cookies. |
| `src/auth/types/auth-payload.ts` | Sin seguimiento | 72 | 0 | 72 | Validador `validateJwtAuthPayload` de claims requeridos (`sessionId`, `generation`). |
| `src/auth/types/auth-payload.spec.ts` | Sin seguimiento | 52 | 0 | 52 | Pruebas de rechazo de tokens legacy y payloads malformados. |
| `src/auth/utils/cookie.util.ts` | Sin seguimiento | 80 | 0 | 80 | Utilidades de serialización, deserialización segura y análisis de cookies `rt_*`. |
| `src/auth/utils/cookie.util.spec.ts` | Sin seguimiento | 95 | 0 | 95 | Pruebas de análisis de nombres de cookie y protección contra prototype pollution. |
| `docs/session-expiration.md` | Sin seguimiento | 180 | 0 | 180 | Arquitectura técnica de concurrencia, CAS y frontera de cookies. |
| `docs/e3-03-handoff.md` | Sin seguimiento | 133 | 0 | 133 | Este documento de traspaso y propuesta de entrega. |
| **Total Backend** | **20 archivos** | **2281** | **44** | **2325** | **Volumen autorado total de la funcionalidad E3-03** |

*Archivos excluidos*: Cualquier archivo temporal, `.env*`, `.yura-ci/` o documentación exterior bajo `odd/`.

## 3. Matriz de Criterios Acordados vs. Evidencia Histórica

| Criterio Acordado | Implementación Técnica Verificada | Evidencia Histórica Registrada |
|---|---|---|
| **C1**: JWT de acceso con `exp` y tiempo de vida corto configurable | [`AuthConfig.getAccessTokenTtlSec()`](../src/auth/auth.config.ts) valida rango [60, 86400]s (default 900s). Claims firmados en [`AuthService`](../src/auth/auth.service.ts). | 59 tests de autenticación pasando (Vitest). Suite completa backend de 94 tests en verde (exit 0). |
| **C2**: Renovación sin credenciales de login y rechazo de tokens expirados | `POST /api/auth/refresh` exige Bearer token vigente y cookie `rt_${sessionId}_g${gen}`. Rechaza con 401 si el token ya expiró o si la credencial opaca es inválida. | Tests en `auth.service.spec.ts` validando rechazo de tokens expirados y carreras CAS concurrentes. |
| **C3**: Revocación inmediata en guard ante avance de generación | [`JwtAuthGuard`](../src/auth/guards/jwt-auth.guard.ts) comprueba que `session.generation === payload.generation` y rechaza con 401 tokens de generaciones previas. | Tests en `jwt-auth.guard.spec.ts` confirmando revocación instantánea de tokens tras renovación. |
| **C4**: Logout revoca sesión en DB incluso con token de acceso expirado | `POST /api/auth/logout` verifica la firma criptográfica (`ignoreExpiration: true` únicamente para identificar la sesión), revoca en PostgreSQL y emite directiva de limpieza `Max-Age=0`. | Cobertura en `auth.service.spec.ts` y `auth.controller.spec.ts` validando respuesta `204 No Content`. |
| **C5**: Retiro seguro de cookies residuales por prueba de posesión | En `/login`, se podan cookies de sesiones previas únicamente si el secreto presentado coincide con `refreshTokenHash` en DB, aislando sesiones de otros navegadores. | Cobertura en `auth.service.spec.ts` y `cookie.util.spec.ts`. |
| **C6**: Validación estricta de estructura y rechazo de tokens legacy | [`validateJwtAuthPayload`](../src/auth/types/auth-payload.ts) valida `sub`, `sessionId` y `generation`; [`AuthConfig`](../src/auth/auth.config.ts) valida variables de entorno. | Tests en `auth-payload.spec.ts` rechazando tokens emitidos antes de E3-03. |
| **C7**: Calidad estática y verificación de compilación | Sin errores de compilación TypeScript ni advertencias de formato. | `pnpm run typecheck` (`tsc --noEmit`), `pnpm run build` (`tsc -p tsconfig.build.json`) y `git diff --check` en exit 0. |

## 4. Contrato de la API y Esquema de Datos

### Endpoints
- **`POST /api/auth/login`**:
  - Código: `201 Created`
  - Body Request: `{ email: string, password: string }`
  - Body Response: `{ accessToken: string, expiresAt: number, user: AuthUser }` (donde `expiresAt` se deriva de `decoded.exp * 1000`).
  - Cookies: `Set-Cookie: rt_${sessionId}_g1=<secreto>; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=<AUTH_REFRESH_TOKEN_TTL_SEC> (default 604800); [Secure en prod]`
- **`POST /api/auth/refresh`**:
  - Código: `201 Created`
  - Headers: `Authorization: Bearer <token_vigente>`, `Origin` / `Referer`, Cookie `rt_${sessionId}_g${gen}`
  - Body Response: `{ accessToken: string, expiresAt: number, user: AuthUser }`
  - Cookies: Poda `rt_${sessionId}_g${gen}` (`Max-Age=0`) y emite `rt_${sessionId}_g${gen+1}` con tiempo remanente.
- **`POST /api/auth/logout`**:
  - Código: `204 No Content`
  - Headers: `Authorization: Bearer <token_vigente_o_expirado>` (firma válida verificada), `Origin` / `Referer`
  - Cookies: `Set-Cookie: rt_${sessionId}_g${gen}=; Path=/api/auth; Max-Age=0` y poda de cookies secundarias de la misma sesión.

### Modelo Prisma (`prisma/schema.prisma`)
```prisma
model AuthSession {
  id               String    @id @default(uuid())
  userId           Int
  generation       Int       @default(1)
  refreshTokenHash String
  revokedAt        DateTime?
  expiresAt        DateTime
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([expiresAt])
  @@map("auth_sessions")
}
```
Migración SQL con restricción en cascada completa:
`ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;`.

## 5. Parámetros de Integración y Frontera Same-Site

### Tabla de Variables de Entorno del Backend
| Variable | Archivo / Método | Default | Rango / Validación | Comportamiento |
|---|---|---|---|---|
| `JWT_SECRET` | [`AuthConfig.getJwtSecret()`](../src/auth/auth.config.ts) | (ninguno) | Cadena no vacía tras `trim()`. Rechaza `dev-secret-no-cambiar`. | Secreto criptográfico. Runtime no impone $\ge 32$ caracteres; se recomienda operativamente $\ge 32$ por seguridad. |
| `AUTH_ACCESS_TOKEN_TTL_SEC` | [`AuthConfig.getAccessTokenTtlSec()`](../src/auth/auth.config.ts) | `900` (15m) | Entero en `[60, 86400]` (regex `/^\d+$/`). | Tiempo de vida de access tokens. |
| `AUTH_REFRESH_TOKEN_TTL_SEC` | [`AuthConfig.getRefreshTokenTtlSec()`](../src/auth/auth.config.ts) | `604800` (7d) | Entero en `[3600, 2592000]`. Exige $\ge 2 \times \text{access TTL}$. | Tiempo de vida absoluto de sesiones en base de datos. |
| `CORS_ORIGIN` | [`AuthConfig.getTrustedOrigins()`](../src/auth/auth.config.ts) | `http://localhost:5173` | Lista de orígenes separados por coma. | Orígenes permitidos en cabecera `Origin` o `new URL(referer).origin`. |
| `NODE_ENV` | [`AuthConfig.isProduction()`](../src/auth/auth.config.ts) | `'development'` | Cadena | Si es `'production'`, activa `Secure` en cookies (requiere HTTPS) y rechaza peticiones sin `Origin`/`Referer` con `403 Forbidden`. |

### Frontera Schemeful Same-Site
- Las cookies de sesión se configuran con `SameSite=Strict`. Esta directiva opera bajo el principio de **schemeful same-site** (mismo esquema y mismo dominio registrable / eTLD+1).
- **Orígenes cruzados en el mismo sitio**: Si frontend y backend difieren en puerto (ej. `http://localhost:5173` frente a `http://localhost:3001` en pruebas locales) o en subdominio pero comparten el mismo eTLD+1 y esquema, el navegador **sí transmite** las cookies de sesión con `credentials: true` y CORS autorizado. No es obligatorio que frontend y backend compartan el mismo origen exacto ni que exista un proxy reverso mandatorio.
- **Sitios distintos o esquemas mixtos**: Si los servicios están en dominios completamente distintos (distinto eTLD+1) o mezclan HTTP y HTTPS, el navegador bloquea las cookies `SameSite=Strict` a pesar de CORS; en tal caso, se requiere mismo sitio o proxy reverso.

## 6. Procedimiento Operativo y Requisitos de Base de Datos
1. **Generación del Cliente Prisma**: Requisito previo de compilación: `pnpm exec prisma generate` o `pnpm run postinstall` (comandos bloqueados existentes en el repositorio).
2. **Migración en Entornos Compartidos / Staging / Producción**:
   - Debe ser ejecutada exclusivamente por el equipo responsable del entorno tras realizar copias de respaldo preventivas.
   - Debe aplicarse utilizando `pnpm exec prisma migrate deploy` (o `pnpm run db:deploy`). **No ejecutar** `prisma migrate dev` (`pnpm run db:migrate`) en entornos compartidos.
3. **Criterio de Reversión (Rollback)**: En caso de requerirse rollback, la compatibilidad debe ser evaluada por el equipo de base de datos; la existencia de claves foráneas en cascada asegura consistencia referencial, pero no constituye una garantía automática de seguridad empresarial sin validación previa.
4. **Alcance de la Auditoría de BD**: La verificación local certificó la línea de base de sesiones (80 sesiones totales, 80 revocadas, 0 activas); no se realizó un snapshot completo de todas las tablas de negocio ajenas a autenticación.
5. **Comandos de Verificación Aislada (`package.json`)**:
   - Pruebas unitarias: `pnpm run test` (`vitest run`).
   - Verificación de tipos: `pnpm run typecheck` (`tsc --noEmit`).
   - Compilación: `pnpm run build` (`tsc -p tsconfig.build.json`).

## 7. Propuesta de Entrega y Política de PR (Pendiente de Autorización)
- **Política del Proyecto ([`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md))**:
  - `El PR apunta a develop, no a main`
  - `El PR tiene menos de 400 líneas de diff`
  - `Los tests pasan en local (pnpm test)`
  - `Agregué tests para el comportamiento nuevo`
- **Advertencia de Volumen**: La funcionalidad completa del backend consta de 20 archivos y 2,325 líneas autoradas (+2,281 / -44). Un PR atómico unitario excede el umbral de 400 líneas.
- **Estrategia de Entrega Propuesta**:
  - **Nivel local**: Se propone un único commit consolidado que reúna comportamiento, pruebas y documentación para no fragmentar suites de pruebas de su código:
    - Mensaje propuesto: `feat(auth): implement E3-03 session expiration and renewal`
    - Rama: `feat/e3-03-session-expiration` (rama actual).
  - **Nivel de PR (Puerta de Política / NOT READY)**: La creación del PR no está lista de forma autónoma. Se debe solicitar al equipo/mantenedor una excepción de tamaño para admitir un PR atómico completo de la funcionalidad, o acordar una estrategia de PRs encadenados con planes y estados intermedios verificables aprobados. La autorización de commits locales por el usuario no anula la política de revisión del repositorio.
  - Las referencias locales de `origin/develop` no han sido actualizadas (`fetch`); la comparación final de la base del PR se realizará tras autorización explícita sin forzar ramas sobre árboles sucios.
