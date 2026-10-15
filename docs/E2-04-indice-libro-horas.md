# E2-04: índice del libro de horas (#29)

## Consulta y metodología

`HourLogService.listForPlacement` filtra por `placementId` y `deletedAt IS NULL`,
y ordena por `date DESC`. Se capturó el SQL que emite Prisma al ejecutar el servicio.
La medición usa ese mismo SQL y sus parámetros en
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`: un calentamiento y 30 muestras
secuenciales. Son tiempos de ejecución de PostgreSQL, sin planificación, transporte
HTTP ni serialización. No se deshabilita el recorrido secuencial ni se fuerza un plan.

Entorno local del 14/10/2026: Node 24.16.0, Prisma 6.19.3, PostgreSQL 16 en Docker.
Se utiliza la base existente: 4003 filas, placement 1,
23 resultados. El benchmark no crea ni modifica registros.

## Antes del cambio

Medido sobre `6616b28` y registrado en un commit y en el PR antes de añadir el índice.
Mediana: **0.307 ms**. Mínimo: 0.277 ms; máximo: 0.366 ms.

```text
Sort  (cost=126.53..126.58 rows=20 width=174) (actual time=0.285..0.286 rows=23 loops=1)
  Sort Key: date DESC
  Sort Method: quicksort  Memory: 28kB
  Buffers: shared hit=76
  ->  Seq Scan on hour_logs  (cost=0.00..126.10 rows=20 width=174) (actual time=0.004..0.274 rows=23 loops=1)
        Filter: (("deletedAt" IS NULL) AND ("placementId" = '1'::bigint))
        Rows Removed by Filter: 3980
        Buffers: shared hit=76
Planning Time: 0.026 ms
Execution Time: 0.302 ms
```

El plan lee secuencialmente la tabla, descarta 3.980 filas y ordena los 23 resultados.
Los índices existentes cubren la clave primaria y `(updatedAt, id)`, pero no esta consulta.

## Después del cambio

Se añadió el índice B-tree compuesto mediante la migración
`20261014220000_hour_logs_placement_date_index`, aplicada con `prisma migrate deploy`:

```sql
CREATE INDEX "hour_logs_placementId_deletedAt_date_idx"
ON "hour_logs"("placementId", "deletedAt", "date" DESC);
```

El mismo índice está declarado en `prisma/schema.prisma`. La consulta del servicio
y la respuesta de la API permanecen iguales.

Plan posterior, mismo placement, 4.003 filas y 23 resultados:

```text
Sort  (cost=38.96..39.01 rows=20 width=174) (actual time=0.026..0.027 rows=23 loops=1)
  Sort Key: date DESC
  Sort Method: quicksort  Memory: 28kB
  Buffers: shared hit=6
  ->  Index Scan using "hour_logs_placementId_deletedAt_date_idx" on hour_logs  (cost=0.28..38.53 rows=20 width=174) (actual time=0.010..0.016 rows=23 loops=1)
        Index Cond: (("placementId" = '1'::bigint) AND ("deletedAt" IS NULL))
        Buffers: shared hit=6
Planning Time: 0.032 ms
Execution Time: 0.047 ms
```

| Medida SQL | Antes | Después |
|---|---:|---:|
| Mediana de 30 muestras | 0.307 ms | 0.049 ms |
| Mínimo | 0.277 ms | 0.042 ms |
| Máximo | 0.366 ms | 0.500 ms |
| Buffers compartidos del plan mostrado | 76 | 6 |

La mediana mejora **6.27 veces (84.04% menos tiempo SQL)**. Los máximos
muestran variación entre muestras; la comparación usa la mediana del mismo protocolo.
PostgreSQL elige el índice sin forzar el optimizador. Aún conserva un Sort de los
23 resultados; el cambio evita el recorrido secuencial de toda la tabla.

## Reproducción y validación

Con PostgreSQL local activo y .env configurado:

```powershell
pnpm db:deploy
pnpm benchmark:hour-logs -- --placement 1
pnpm typecheck
node -r dotenv/config node_modules/vitest/vitest.mjs run --coverage
pnpm exec eslint scripts/benchmark-hour-logs.mjs src/hour-log/hour-log.index.spec.ts
```

El benchmark compila desde cero, captura el SQL del servicio y falla si el plan no
usa el índice esperado. No cambia datos ni parámetros del optimizador. Si la base
está vacía, requiere los datos del seed; omitir `--placement 1` elige el libro con
más registros activos. Los planes dependen del volumen, distribución y estadísticas.

La prueba de integración usa una tabla temporal con 20.000 registros y 1.000
placements. Ejecuta el archivo de migración real sobre esa tabla, verifica
Seq Scan antes, uso del índice después, exclusión de borrados y las mismas filas
y orden. La tabla desaparece al terminar y no modifica datos ni índices públicos.

Resultado local: **182 tests en 25 archivos pasan**, esquema Prisma válido,
typecheck y build pasan, ESLint de los archivos nuevos pasa. La rama parte de
develop; los cambios de E2-03 siguen únicamente en su propia rama y PR #34.
