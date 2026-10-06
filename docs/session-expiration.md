# Arquitectura de Expiración de Sesión y Renovación Atómica (T2 E3-03)

## 1. Visión General y Decisiones de Diseño

Este documento describe la implementación del ciclo de vida y expiración de sesiones en el backend de Prácticas Preprofesionales, garantizando persistencia en PostgreSQL (`AuthSession`), rotación atómica de credenciales opacas, ciclo de vida acotado de cookies y aislamiento total contra carreras de cookies entre pestañas y navegadores.

### Principios Fundamentales
1. **Renovación Explícita antes de la Expiración**:
   - El cliente frontend solicita la renovación antes de que el token de acceso expire.
   - Si el token de acceso ya expiró, el endpoint de renovación lo rechaza inmediatamente (`401 Unauthorized`), impidiendo renovaciones silenciosas y obligando a una reautenticación limpia.
2. **Esquema de Cookies Específico por Sesión y Generación (`rt_${sessionId}_g${generation}`)**:
   - Cada sesión y generación de rotación utiliza un nombre de cookie único y exacto.
   - En una renovación, se establece `rt_${sessionId}_g${gen+1}` y se limpia `rt_${sessionId}_g${gen}` (`Max-Age=0`).
   - Si una petición retrasada de una generación anterior (`gen`) responde después de que `gen+1` ya se aplicó, **no sobreescribe ni destruye** la cookie vigente de `gen+1` porque tienen nombres distintos.
   - Si una pestaña ejecuta logout sobre una sesión previa, solo elimina las cookies asociadas a esa sesión (`sessionId`), manteniendo intactas sesiones activas concurrentes en otros navegadores o contextos.
3. **Verificación Criptográfica Previa a la Selección de Credenciales**:
   - Ningún claim de sesión (`sessionId`, `generation`, `sub`) se confía ni se consulta en base de datos o jar de cookies sin haber validado primero la firma criptográfica del JWT con el secreto del servidor (`JWT_SECRET`).
   - La estructura de claims es validada estrictamente por `validateJwtAuthPayload`, mientras que la asignación de claims en la emisión es efectuada por `AuthService`. Tokens legacy que carezcan de la estructura de sesión requerida (`sessionId`, `generation`) son rechazados en `JwtAuthGuard` con `401 Unauthorized` (`estructura de sesión inválida en el token`).
   - En `/auth/logout`, se admite que el access token esté expirado, pero la firma debe ser auténtica (`ignoreExpiration: true` únicamente para identificar la sesión a revocar). Tokens con firmas alteradas o falsificadas son rechazados (`401 Unauthorized`).
4. **Renovación Atómica (Compare-And-Swap en PostgreSQL)**:
   - La renovación ejecuta un `updateMany` con condición estricta: `id = sessionId`, `userId = sub`, `generation = gen`, `refreshTokenHash = sha256(secret)`, `revokedAt IS NULL`, y `expiresAt > NOW()`.
   - Si otra petición concurrente avanzó la generación, `updateMany` retorna 0 filas afectadas. La petición desfasada es rechazada con `401 Unauthorized` **sin revocar** la sesión activa avanzada, evitando ataques o fallas de Denegación de Servicio (DoS).
5. **Revocación Inmediata en Guard (`JwtAuthGuard`)**:
   - `JwtAuthGuard` comprueba que la sesión exista en PostgreSQL, no esté revocada ni expirada, que el usuario coincida (`session.userId === payload.sub`), y que `session.generation === payload.generation`.
   - En cuanto ocurre una renovación, los tokens de acceso antiguos quedan inmediatamente revocados sin esperar a que transcurra su tiempo `exp`.
6. **Defensa de Origen, CORS y Frontera de Cookies**:
   - `/auth/login`, `/auth/refresh` y `/auth/logout` mutan cookies y credenciales.
   - Se valida el header `Origin` contra la lista permitida (`CORS_ORIGIN`).
   - Política de origen ausente: Si `Origin` falta, se valida `Referer` extrayendo exactamente `new URL(referer).origin` y rechazando credenciales incrustadas (`user:pass@host`) o dominios parecidos (`host.attacker.com`). En producción (`NODE_ENV === 'production'`), si ambos faltan, la mutación se rechaza con `403 Forbidden` para proteger cookies de peticiones no autenticadas con origen suprimido; en desarrollo se admite para pruebas locales por CLI/curl.
   - **Frontera SameSite=Strict y CORS**: Las cookies de sesión se emiten con `HttpOnly; SameSite=Strict; Path=/api/auth` y directiva `Secure` activada en producción (`NODE_ENV === 'production'`, requiriendo HTTPS). El atributo `SameSite=Strict` opera bajo la frontera de **schemeful same-site** (mismo esquema y mismo dominio registrable). Por ende, orígenes cruzados que compartan el mismo sitio aunque varíen de puerto o subdominio (por ejemplo, frontend en `http://localhost:5173` y backend en `http://localhost:3001` durante las pruebas locales) transmiten exitosamente las cookies si CORS autoriza el origen y se especifica `credentials: true`. En contraste, sitios diferentes (distinto eTLD+1) o esquemas mixtos (`http` frente a `https`) son bloqueados por el navegador independientemente de CORS; para tales escenarios se requiere desplegar bajo el mismo sitio o integrar un proxy reverso (opcional).
7. **Poda y Acotamiento Seguro de Cookies en Reemplazo de Cuenta**:
   - **Límites de Seguridad**: La cabecera `Cookie` está acotada a un máximo de 4096 bytes (`MAX_COOKIE_HEADER_BYTES`), y se procesan como máximo 10 cookies de autenticación (`MAX_AUTH_COOKIES_PARSED`). Peticiones que superen estos límites fallan de forma segura con `401 Unauthorized` / `400 Bad Request` sin realizar mutaciones parciales.
   - **Retiro con Prueba Criptográfica de Posesión**: Al iniciar sesión con credenciales nuevas, si el navegador presenta cookies de sesiones anteriores, el servidor solo retira/revoca aquellas sesiones cuyo secreto opaco coincide con el hash almacenado en base de datos (`refreshTokenHash`) para esa generación específica.
   - **Aislamiento Total**: Peticiones con cookies falsificadas o alteradas no pueden revocar sesiones activas ajenas. Sesiones de otros navegadores permanecen completamente intactas.
   - **TTL Absoluto en Renovación**: La cookie de renovación (`Max-Age`) no se resetea ciegamente a 7 días en cada refresh; utiliza estrictamente el tiempo remanente antes del vencimiento absoluto de la sesión en base de datos (`session.expiresAt`).
   - **Expiración de Acceso Exacta (`expiresAt`)**: El campo `expiresAt` retornado en la respuesta JSON corresponde exactamente al timestamp en milisegundos del claim `exp` del JWT (`decoded.exp * 1000`), evitando discrepancias o milisegundos engañosos.

---

## 2. Condiciones de Carrera y Predicados Atómicos (Login vs Refresh)

### El Riesgo de "Find-Then-Unconditional-Revoke"
Si el sistema utilizara una búsqueda previa seguida de una revocación incondicional (`findFirst` -> `update({ revokedAt: now })`):
1. La Pestaña A inicia una renovación (`/refresh`) de la sesión $S_1$ en generación $g_1$.
2. La Pestaña B simultáneamente ejecuta login (`/login`) presentando la cookie $rt\_S_1\_g_1$.
3. La Pestaña A ejecuta su CAS y avanza $S_1$ a la generación $g_2$.
4. Si la Pestaña B revocara incondicionalmente por `id: S_1`, revocaría la sesión ya avanzada en $g_2$, destruyendo la sesión legítimamente renovada en la Pestaña A.

### Solución Mediante CAS y Recomprobación Atómica
En lugar de revocación incondicional, `AuthService.login` aplica un predicado CAS estricto:
```typescript
const retired = await this.prisma.authSession.updateMany({
  where: {
    id: parsed.sessionId,
    generation: parsed.generation,
    refreshTokenHash: incomingHash,
    revokedAt: null,
  },
  data: {
    revokedAt: new Date(),
  },
})
```
- **Caso 1: El CAS tiene éxito (`retired.count > 0`)**: La sesión presentada estaba en esa generación exacta y el secreto coincidió. La sesión es revocada y el nombre de la cookie (`rt_S1_g1`) se agrega a `prunedCookieNames` para ser limpiada del navegador.
- **Caso 2: El CAS retorna 0 filas (`retired.count === 0`)**:
  El servidor consulta el estado actual de la sesión en DB:
  - Si la sesión no existe, o ya está revocada, o ya expiró su tiempo absoluto, se agrega `cookieName` a `prunedCookieNames` para limpiar la cookie muerta del navegador.
  - Si la sesión existe, no está revocada y `existing.generation > parsed.generation`: significa que la sesión avanzó concurrentemente a una generación más nueva. La sesión activa en DB **NO es revocada**. La cookie antigua de generación previa (`rt_S1_g1`) es considerada obsoleta/stale y se incluye en `prunedCookieNames` para ser limpiada del navegador local, dejando la generación vigente intacta.
  - Si la sesión existe, está activa y `existing.generation === parsed.generation`, pero el hash no coincidió (intento de suplantación o cookie falsificada): la cookie **NO es podada ni revocada**, preservando la sesión legítima sin permitir DoS.

### Límite de Procesamiento de Cookies y Procedimiento de Recuperación Documentado
- Para evitar que peticiones con cabeceras `Cookie` artificialmente infladas provoquen consultas no acotadas a la base de datos (DoS de CPU/I-O):
  1. Si `Cookie.length > MAX_COOKIE_HEADER_BYTES` (4096 bytes), la petición se rechaza inmediatamente antes de procesar cualquier mutación.
  2. Si el número de cookies reconocidas de autenticación (`rt_*`) excede `MAX_AUTH_COOKIES_PARSED` (10), la petición falla con `401 Unauthorized` / `400 Bad Request`.
  3. No se realiza revocación ni creación parcial de sesiones cuando se exceden los límites.
- **Procedimiento de Recuperación Documentado**:
  Si el almacenamiento de cookies de un navegador se satura con cookies residuales (por ejemplo, tras pruebas intensivas o desarrollo), el usuario o la aplicación cliente debe:
  1. Ejecutar una limpieza de cookies para la ruta `/api/auth` en el navegador, o
  2. Llamar a `/api/auth/logout` con el token activo para limpiar las cookies de la sesión actual, o
  3. En herramientas de desarrollo, eliminar las cookies del dominio del frontend/backend.

### Límites de Coordinación del Protocolo (Frontera del Sistema)
El protocolo HTTP y el almacenamiento de cookies en navegadores no admiten transacciones atómicas distribuidas entre pestañas. El diseño de este backend garantiza que:
1. Una respuesta desfasada o tardía solo emite directivas `Set-Cookie` para su clave específica (`rt_${sessionId}_g${old_gen}=; Max-Age=0`), sin comodines (`*`) ni claves de generaciones futuras.
2. El servidor no impone topes globales de sesiones por usuario ni revoca sesiones de navegadores independientes.
3. Cualquier reintroducción de una cookie obsoleta por una respuesta tardía será podada de forma segura en las siguientes peticiones de login/refresh sin afectar las sesiones activas.

---

## 3. Modelo de Persistencia (PostgreSQL / Prisma)

El modelo en `prisma/schema.prisma` mapea la tabla relacional `auth_sessions`:
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
En la migración SQL (`migration.sql`), la clave foránea aplica cascada bidireccional:
`ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;`.

---

## 4. Contrato de la API

### `POST /api/auth/login`
- **Request Body**: `{ email: string, password: string }`
- **Headers**: `Origin: <trusted_origin>` (o `Referer` autorizado)
- **Response**: `201 Created`
  ```json
  {
    "accessToken": "eyJhbGciOi...",
    "expiresAt": 1743859200000,
    "user": {
      "id": 1,
      "email": "estudiante0@miyura.com",
      "fullName": "Estudiante 0",
      "role": "STUDENT",
      "companyId": null
    }
  }
  ```
- **Cookies**: `Set-Cookie: rt_${sessionId}_g1=<opaque_secret>; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=<AUTH_REFRESH_TOKEN_TTL_SEC> (default: 604800); [Secure en prod con HTTPS]`
- **Propiedad `expiresAt`**: Timestamp numérico en milisegundos calculado directamente desde el claim `exp` del JWT (`decoded.exp * 1000`).

### `POST /api/auth/refresh`
- **Headers**:
  - `Authorization: Bearer <valid_unexpired_access_token>`
  - `Origin: <trusted_origin>` (o `Referer` autorizado)
  - `Cookie: rt_${sessionId}_g${current_gen}=<opaque_secret>`
- **Response**: `201 Created`
  ```json
  {
    "accessToken": "eyJhbGciOi...",
    "expiresAt": 1743859900000,
    "user": {
      "id": 1,
      "email": "estudiante0@miyura.com",
      "fullName": "Estudiante 0",
      "role": "STUDENT",
      "companyId": null
    }
  }
  ```
- **Cookies**:
  - `Set-Cookie: rt_${sessionId}_g${current_gen}=; Path=/api/auth; Max-Age=0`
  - `Set-Cookie: rt_${sessionId}_g${next_gen}=<new_opaque_secret>; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=<remaining_session_seconds>; [Secure en prod con HTTPS]`

### `POST /api/auth/logout`
- **Headers**:
  - `Authorization: Bearer <valid_or_expired_access_token>` (requiere firma criptográfica válida; ignora expiración únicamente para identificar la sesión)
  - `Origin: <trusted_origin>` (o `Referer` autorizado)
- **Response**: `204 No Content`
- **Cookies**:
  - `Set-Cookie: rt_${sessionId}_g${gen}=; Path=/api/auth; Max-Age=0` (y poda de cookies residuales de la misma sesión en el navegador)

---

## 5. Variables de Entorno

| Variable | Tipo | Default | Rango Válido | Descripción |
|---|---|---|---|---|
| `JWT_SECRET` | string | (requerido) | string no vacío | Secreto criptográfico. [`AuthConfig.getJwtSecret()`](src/auth/auth.config.ts) valida estrictamente que la cadena no esté vacía tras `trim()` y rechaza el fallback inseguro `dev-secret-no-cambiar`. *Nota de seguridad*: No hay validación de longitud mínima codificada en runtime; se recomienda operativamente una longitud $\ge 32$ caracteres por estándar criptográfico. |
| `AUTH_ACCESS_TOKEN_TTL_SEC` | integer | `900` (15m) | [60, 86400] | Tiempo de vida del access token en segundos. Validación estricta con regex `/^\d+$/`. |
| `AUTH_REFRESH_TOKEN_TTL_SEC` | integer | `604800` (7d) | [3600, 2592000] | Tiempo de vida absoluto de la sesión en segundos. Debe ser al menos el doble de `AUTH_ACCESS_TOKEN_TTL_SEC` ($\ge 2 \times \text{access}$). |
| `CORS_ORIGIN` | string | `http://localhost:5173` | URI(s) | Orígenes autorizados separados por coma. |
| `NODE_ENV` | string | `'development'` | string | Si es `'production'`, activa la directiva `Secure` en cookies y rechaza mutaciones sin cabecera `Origin`/`Referer` con `403 Forbidden`. |
