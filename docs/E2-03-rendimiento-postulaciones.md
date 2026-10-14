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

La comparación posterior y los comandos reproducibles se añadirán después del cambio.
