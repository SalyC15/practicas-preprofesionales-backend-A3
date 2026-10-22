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

## D-02 · `HourLogService` se nos fue de las manos (resuelto en E6-03)

El servicio se separó en unidades de registro y revisión, autorización y consulta, reportes,
exportación y notificación. `HourLogService` conserva la API pública como fachada.

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

## D-05 · `calculateAccreditationStatus` da miedo tocarla (resuelto en E5-02)

`src/placement/accreditation.ts`

Antes: ESLint la marcaba por complejidad (`complexity` 17, `sonarjs/cognitive-complexity`
84) y eran `if` anidados hasta seis niveles con toda la lógica de acreditación adentro.
Funcionaba — hasta donde sabemos — pero solo había dos tests, así que cualquier cambio era
a ciegas.

Resuelto en dos pasos. E5-01 dejó los 16 tests de caracterización que hoy fijan el
comportamiento (niveles, mensajes, orden de los mensajes y porcentaje). E5-02 reescribió la
decisión como una lista ordenada de reglas independientes: gana la primera que aplica y el
orden de la lista es la prioridad. Agregar una regla nueva es agregar una entrada a esa
lista, sin tocar las existentes, y el archivo quedó sin hallazgos de ESLint.

Los tests de caracterización y la tabla de reglas: [E5-01](docs/E5-01-reglas-acreditacion.md).
La estructura elegida y cómo se lee: [E5-02](docs/E5-02-reglas-acreditacion.md).

## D-07 · `JWT_SECRET` tiene un fallback hardcodeado

`src/auth/auth.module.ts`

Si la variable de entorno no está, el módulo arranca igual con un secreto por defecto que
está en el código. Lo pusimos para no pelear con el entorno local y se quedó. En producción
esto no puede quedar así.
