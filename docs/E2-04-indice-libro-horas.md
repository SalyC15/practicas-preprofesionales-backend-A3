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

Pendiente: migración, plan posterior, comparación de tiempos y comandos reproducibles.
