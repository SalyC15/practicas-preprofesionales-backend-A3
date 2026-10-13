# Revisión de Seguridad: Endpoints que devuelven y consultan usuarios

## 1. Propósito y Alcance

Este documento constituye la revisión técnica y auditoría exhaustiva de seguridad sobre la exposición de entidades y datos de usuarios (`User`) en el backend de prácticas preprofesionales.

El objetivo es garantizar que:
1. **Ninguna respuesta HTTP incluya credenciales (`password`, hashes, tokens internos) ni campos internos.**
2. **Cada consulta a la base de datos que interactúe con el modelo `User` acote explícitamente los campos mediante `select`**, aplicando el principio de mínimo privilegio en el acceso a datos.
3. **Exista protección automatizada contra regresiones** mediante tests que validen la forma de las respuestas y fallen si se reintroduce un campo sensible.

---

## 2. Inventario Completo de Endpoints del Backend

A continuación se categorizan todos los endpoints expuestos por los controladores de la aplicación:

| Endpoint | Método | Controlador | ¿Devuelve datos de usuario? | ¿Consulta `User` en BD? |
| :--- | :--- | :--- | :---: | :---: |
| `/auth/login` | `POST` | `AuthController` | **SÍ** (objeto `user`) | **SÍ** |
| `/auth/refresh` | `POST` | `AuthController` | **SÍ** (objeto `user`) | **SÍ** |
| `/auth/logout` | `POST` | `AuthController` | No (`204 No Content`) | No |
| `/applications` | `POST` | `ApplicationController` | No (retorna `Application`) | No |
| `/offers/:offerId/applications` | `GET` | `ApplicationController` | **SÍ** (anidado en `student`) | **SÍ** |
| `/applications/me` | `GET` | `ApplicationController` | No (retorna `Application[]`) | No |
| `/applications/:id/decide` | `PATCH` | `ApplicationController` | No (retorna `Application`) | No |
| `/placements` | `POST` | `PlacementController` | No (retorna `Placement`) | No |
| `/placements/me` | `GET` | `PlacementController` | **SÍ** (anidado en `tutor`) | **SÍ** (vía relación) |
| `/placements/accreditation` | `GET` | `PlacementController` | No (solo DTO de cálculo) | **SÍ** (vía relación) |
| `/placements/:id/activate` | `PATCH` | `PlacementController` | No (retorna `Placement`) | No |
| `/placements/:id/documents` | `POST` | `PlacementController` | No (retorna `Document`) | No |
| `/offers` | `GET` | `OfferController` | No (retorna `Offer[]`) | No |
| `/offers/me` | `GET` | `OfferController` | No (retorna `Offer[]`) | **SÍ** (resuelve `companyId`) |
| `/offers/:id` | `GET` | `OfferController` | No (retorna `Offer`) | No |
| `/offers` | `POST` | `OfferController` | No (retorna `Offer`) | No |
| `/offers/:id/publish` | `PATCH` | `OfferController` | No (retorna `Offer`) | No |
| `/offers/:id/close` | `PATCH` | `OfferController` | No (retorna `Offer`) | No |
| `/companies` | `GET` | `CompanyController` | No (retorna `Company[]`) | No |
| `/companies` | `POST` | `CompanyController` | No (retorna `Company`) | No |
| `/hour-logs` | `POST` | `HourLogController` | No (retorna `HourLog`) | No |
| `/placements/:id/hour-logs` | `GET` | `HourLogController` | No (retorna `HourLog[]`) | No |
| `/placements/:id/progress` | `GET` | `HourLogController` | No (reporte numérico) | No |
| `/hour-logs/:id/review` | `PATCH` | `HourLogController` | No (retorna `HourLog`) | No |
| `/evaluations` | `POST` | `EvaluationController` | No (retorna `Evaluation`) | **SÍ** (valida pertenencia) |
| `/placements/:id/evaluations` | `GET` | `EvaluationController` | No (retorna `Evaluation[]`) | No |
| `/sync/pull` | `GET` | `SyncController` | No (cambios sin usuarios) | No |
| `/sync/push` | `POST` | `SyncController` | No (resultado sync) | No |

---

## 3. Detalle de Endpoints que devuelven información de Usuarios

### 3.1. `POST /auth/login`
- **Controlador:** `AuthController.login`
- **Servicio:** `AuthService.login`
- **Autenticación requerida:** Pública (credenciales email y password).
- **Entidad devuelta en payload:** `user: UserResponseDto` dentro de `AuthSuccessResponse`.
- **Campos expuestos:**
  1. `id` (`number`): Identificador único del usuario. Requerido por el frontend para correlación de estado y vistas.
  2. `email` (`string`): Correo institucional / corporativo del usuario autenticado.
  3. `fullName` (`string`): Nombre y apellido para saludo y perfil en UI.
  4. `role` (`Role`: `STUDENT` | `TUTOR` | `COMPANY` | `COORDINATOR`): Rol del usuario para control de navegación y permisos en el cliente.
  5. `companyId` (`number | null`): Identificador de la empresa si el usuario pertenece a una (o `null`).
- **Campos explícitamente excluidos:** `password`, `createdAt`, `authSessions`, `refreshTokenHash`.
- **Acotación en la consulta a Base de Datos:**
  En `src/auth/auth.service.ts`:
  ```typescript
  const user = await this.prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password: true, // Necesario estrictamente para bcrypt.compare en el proceso de autenticación
      fullName: true,
      role: true,
      companyId: true,
    },
  })
  ```
  La respuesta HTTP construye explícitamente un objeto sin `password`:
  ```typescript
  user: {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role as Role,
    companyId: user.companyId,
  }
  ```

---

### 3.2. `POST /auth/refresh`
- **Controlador:** `AuthController.refresh`
- **Servicio:** `AuthService.refresh`
- **Autenticación requerida:** Bearer token (JWT de acceso) + Cookie de sesión segura rotada.
- **Entidad devuelta en payload:** `user: UserResponseDto` dentro de `AuthSuccessResponse`.
- **Campos expuestos:**
  1. `id` (`number`)
  2. `email` (`string`)
  3. `fullName` (`string`)
  4. `role` (`Role`)
  5. `companyId` (`number | null`)
- **Campos explícitamente excluidos:** `password`, `createdAt`, `refreshTokenHash`, `refreshTokenSecret` (viaja exclusivamente en cookie HttpOnly).
- **Acotación en la consulta a Base de Datos:**
  En `src/auth/auth.service.ts`:
  ```typescript
  const user = await this.prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      companyId: true,
      // NOTA: password NO se consulta ni se carga a memoria durante la renovación.
    },
  })
  ```

---

### 3.3. `GET /offers/:offerId/applications`
- **Controlador:** `ApplicationController.listByOffer`
- **Servicio:** `ApplicationService.listByOffer`
- **Autenticación y Roles:** `JwtAuthGuard`, `Roles(Role.COMPANY, Role.COORDINATOR)`
- **Entidad devuelta en payload:** Arreglo de postulaciones con objeto anidado `student`.
- **Campos expuestos en `student`:**
  1. `id` (`number`): ID de usuario del estudiante para identificarlo.
  2. `email` (`string`): Correo de contacto del postulante para citación o seguimiento.
  3. `fullName` (`string`): Nombre del estudiante para visualización por parte de la empresa/coordinador.
- **Campos explícitamente excluidos:** `password`, `role`, `companyId`, `createdAt`, `authSessions`.
- **Acotación en la consulta a Base de Datos:**
  En `src/application/application.service.ts`:
  ```typescript
  const student = await this.prisma.user.findUnique({
    where: { id: application.studentId },
    select: { id: true, email: true, fullName: true },
  })
  ```

---

### 3.4. `GET /placements/me`
- **Controlador:** `PlacementController.findMine`
- **Servicio:** `PlacementService.findForStudent`
- **Autenticación y Roles:** `JwtAuthGuard`, `Roles(Role.STUDENT)`
- **Entidad devuelta en payload:** Registro de `Placement` del estudiante autenticado con relación `tutor`.
- **Campos expuestos en `tutor`:**
  1. `id` (`number`): ID del tutor académico asignado.
  2. `fullName` (`string`): Nombre del tutor para que el estudiante sepa con quién contactarse.
  3. `email` (`string`): Correo electrónico del tutor para coordinación académica.
- **Campos explícitamente excluidos:** `password`, `role`, `companyId`, `createdAt`, `authSessions`.
- **Acotación en la consulta a Base de Datos:**
  En `src/placement/placement.service.ts`:
  ```typescript
  include: {
    company: true,
    tutor: { select: { id: true, fullName: true, email: true } },
    documents: true,
  }
  ```

---

## 4. Consultas Internas a la Base de Datos (`User`) sin Exposición en la Respuesta

Existen servicios que realizan consultas a la tabla `users` para validar permisos o agregaciones, sin que el objeto usuario sea retornado al cliente. Todas han sido acotadas explícitamente:

1. **`AccreditationService.reportForPeriod` (`GET /placements/accreditation`):**
   - Retorna: `AccreditationResult[]` (solo calcula estados de acreditación y expone `studentName` como string primitivo).
   - Consulta acotada:
     ```typescript
     include: {
       student: { select: { fullName: true } },
       documents: true,
       evaluations: true,
     }
     ```
   - *Impacto de seguridad:* Se eliminó la inclusión indiscriminada (`student: true`) que traía la fila completa con `password`.

2. **`EvaluationService.submit` (`POST /evaluations`):**
   - Valida que la empresa del evaluador coincida con la empresa del placement (`assertCompanyEvaluation`).
   - Consulta acotada:
     ```typescript
     const evaluator = await this.prisma.user.findUnique({
       where: { id: evaluatorId },
       select: { companyId: true },
     })
     ```
   - *Impacto de seguridad:* Se eliminó la consulta abierta que traía toda la entidad `User`.

3. **`OfferService.findAllForCompanyUser` (`GET /offers/me`):**
   - Obtiene el `companyId` del usuario autenticado para listar las ofertas de su empresa.
   - Consulta acotada:
     ```typescript
     const user = await this.prisma.user.findUnique({
       where: { id: userId },
       select: { companyId: true },
     })
     ```

---

## 5. Estrategia de Protección contra Regresiones

Como se destaca en las notas técnicas del proyecto, **una revisión estática caduca al siguiente Pull Request**. Para garantizar la durabilidad de esta auditoría, se implementó una suite de pruebas automatizadas en `src/user-exposure.spec.ts`.

### Características de la protección automatizada:
1. **Validador Recursivo (`assertNoSensitiveFields`):**
   Inspecciona cualquier estructura de datos devuelta por los endpoints y servicios a cualquier nivel de anidamiento. Falla si encuentra alguna propiedad sensible (`password`, `passwordHash`, `refreshTokenHash`, `refreshTokenSecret`, `secret`, `salt`).
2. **Validación Estricta de Formas (Shape Matching):**
   Compara los campos presentes en los objetos contra las listas blancas permitidas (`Object.keys(user).sort()`). Si un desarrollador agrega un campo sensible o inesperado, el test falla.
3. **Verificación de Cláusulas `select` en Prisma:**
   Espía y valida las llamadas a Prisma (`prisma.user.findUnique`, `include.tutor.select`, `include.student.select`) garantizando que ningún refactor retire la acotación de campos en la capa de datos.

---

## 6. Checklist de Buenas Prácticas para Futuros PRs

- [ ] ¿El nuevo endpoint devuelve datos de usuario? Si es así, documentar en este archivo la necesidad de negocio de cada campo.
- [ ] ¿La consulta a `prisma.user.*` o cualquier relación (`student`, `tutor`, `user`, `reviewer`) tiene un bloque `select` explícito?
- [ ] ¿Se ejecutó la suite `pnpm exec vitest run src/user-exposure.spec.ts` para verificar ausencia de regresiones?
- [ ] ¿Bajo ninguna circunstancia se usa `include: { user: true }` o `include: { student: true }`?
