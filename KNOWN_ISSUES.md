# Problemas conocidos

Lo que sabemos que está mal y no alcanzamos a arreglar. Está ordenado por lo que más nos
dolió, no por severidad técnica.

Si encuentras algo que no está acá, agrégalo. Casi seguro hay más.

## D-01 · El sync duplica horas al reintentar

`src/offline/sync/push.ts` (front) y `src/sync/sync.service.ts` (back).

Si el push se corta a medias y el cliente reintenta, a veces aparecen dos registros de horas
idénticos. Pasa más en la práctica de campo, con señal intermitente. Mandamos un `clientOpId`
en cada operación y guardamos las operaciones en `sync_operations`, pero evidentemente algo
no está cerrando el círculo. No tuvimos tiempo de sentarnos a entenderlo.

Workaround actual: el coordinador borra los duplicados a mano.

## D-02 · `HourLogService` se nos fue de las manos

`src/hour-log/hour-log.service.ts`

Empezó siendo el CRUD de horas y terminó haciendo validación, persistencia, notificación al
tutor y agregación de reportes. Pasa las 300 líneas. Cada vez que hay que tocar algo ahí, hay
que leerlo entero. Habría que partirlo por responsabilidad, pero nunca fue prioridad.

## D-03 · El módulo de evaluaciones no tiene tests

`src/evaluation/`

Cero. Lo hicimos en la última semana y no alcanzamos. Es el módulo que más baja la cobertura
del proyecto. Si vas a tocar rúbricas o scores, escribe los tests primero — nadie sabe qué se
rompe.

## D-04 · La lista de postulaciones va lenta (resuelto en E2-03)

`src/application/application.service.ts`, método `listByOffer`.

Se eliminó la consulta por candidato mediante la carga conjunta de estudiantes.
El listado ejecuta dos consultas independientemente del número de postulaciones.
Mediciones y reproducción: [E2-03](docs/E2-03-rendimiento-postulaciones.md).

## D-05 · `calculateAccreditationStatus` da miedo tocarla

`src/placement/accreditation.ts`

ESLint la marca por complejidad. Son `if` anidados hasta seis niveles con toda la lógica de
acreditación adentro. Funciona — hasta donde sabemos — pero solo hay dos tests, así que
cualquier cambio es a ciegas. Si te toca modificar reglas de acreditación, escribe primero
tests de los casos que hoy funcionan.

## D-07 · `JWT_SECRET` tiene un fallback hardcodeado

`src/auth/auth.module.ts`

Si la variable de entorno no está, el módulo arranca igual con un secreto por defecto que
está en el código. Lo pusimos para no pelear con el entorno local y se quedó. En producción
esto no puede quedar así.
