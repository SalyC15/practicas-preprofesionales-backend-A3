# E2-03: consultas de la lista de postulaciones (#28)

## Línea base, antes de modificar el servicio

Medición local del 14 de octubre de 2026 sobre `6616b28`, Node 24.16.0,
Prisma 6.19.3 y PostgreSQL 16 en Docker (`127.0.0.1:5434`).
La línea base se registra en un commit y en el PR antes del cambio del servicio.

Se ejecutó `GET /api/offers/:offerId/applications` por HTTP loopback en una
instancia Nest independiente, con los guards JWT, sesión y autorización reales.
Se contaron los eventos SQL de Prisma durante cada petición. El tiempo comprende
la petición HTTP y la lectura del JSON; excluye login, preparación de datos y arranque.
Cada caso tiene un calentamiento y diez muestras secuenciales, sin carga concurrente.
Se crearon postulantes distintos en ofertas temporales de 0, 1, 20 y 200 candidatos;
los datos de prueba se eliminaron al finalizar sin alterar los datos existentes.

| Rol | Postulaciones | SQL por petición | Mediana (ms) | Máximo (ms) |
|---|---:|---:|---:|---:|
| Empresa | 0 | 4 | 6,47 | 8,06 |
| Empresa | 1 | 5 | 5,90 | 7,03 |
| Empresa | 20 | 24 | 24,40 | 34,22 |
| Empresa | 200 | 204 | 239,64 | 325,31 |
| Coordinación | 0 | 3 | 5,37 | 6,15 |
| Coordinación | 1 | 4 | 9,39 | 11,21 |
| Coordinación | 20 | 23 | 29,31 | 34,33 |
| Coordinación | 200 | 203 | 251,81 | 273,93 |

El método de listado ejecuta `1 + N` consultas: una para las postulaciones y una
por estudiante. El endpoint añade una consulta de sesión y una de oferta; empresa
añade además una consulta de pertenencia. Totales: `N + 4` y `N + 3`.
La línea base ya queda debajo de 500 ms en este equipo; el problema medido es el
crecimiento lineal de las consultas, no un incumplimiento inventado del umbral.

## Contrato y reproducción

La respuesta conserva todos los campos escalares de cada postulación y únicamente
`student: { id, email, fullName }`. La medición compara cada respuesta completa contra
esos datos, incluyendo estados, fechas y valores nulos.

## Después del cambio

Prisma carga las postulaciones y sus estudiantes en dos consultas de datos, sin
consultas por candidato. No se modificó el controlador, la autorización ni el frontend.
Con una lista vacía se omite la consulta de estudiantes: el total es aún menor.

| Rol | Postulaciones | SQL por petición | Mediana (ms) | Máximo (ms) |
|---|---:|---:|---:|---:|
| Empresa | 0 | 4 | 8,37 | 13,75 |
| Empresa | 1 | 5 | 6,78 | 7,68 |
| Empresa | 20 | 5 | 6,74 | 11,24 |
| Empresa | 200 | 5 | 12,22 | 13,71 |
| Coordinación | 0 | 3 | 5,00 | 6,75 |
| Coordinación | 1 | 4 | 5,04 | 5,93 |
| Coordinación | 20 | 4 | 5,31 | 6,18 |
| Coordinación | 200 | 4 | 10,86 | 11,86 |

Las diez respuestas con 200 postulaciones quedaron por debajo de 500 ms en ambos
roles. El SQL es constante con 1, 20 y 200 candidatos: cinco consultas para empresa
y cuatro para coordinación, incluyendo sesión y autorización. El listado por sí
solo pasa de 201 a dos consultas.

## Cómo repetir la verificación

Con Node 24+, PostgreSQL local activo y el archivo .env configurado:

```powershell
pnpm exec prisma generate
pnpm db:deploy
pnpm benchmark:applications
```

El último comando compila desde cero y ejecuta la medición por HTTP con datos
temporales; falla si crece el SQL entre 1, 20 y 200 postulaciones, si cualquier
muestra de 200 supera 500 ms o si cambia el contrato de respuesta. Publica las diez
muestras de cada caso en JSON y limpia los datos al terminar.
Para repetir la línea base, conserva una copia del script y ejecútala sin
`--verify` desde un checkout de `98c2149`, después de compilarlo sin incremental.
Los tiempos son de este equipo y de peticiones secuenciales, no una prueba de carga.

Validación: 184 tests en 24 archivos pasan con cobertura, typecheck y build pasan;
ESLint pasa en los archivos modificados. Se conservan las pruebas de acceso por
empresa/coordinación y de ausencia de campos sensibles del estudiante.
