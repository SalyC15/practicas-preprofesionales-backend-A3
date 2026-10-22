# E5-02: reglas de acreditación como lista ordenada

Refactor de `calculateAccreditationStatus` (`src/placement/accreditation.ts`) para que la
decisión de acreditación se lea como una lista de reglas y no como `if` anidados.
El comportamiento no cambia: es el mismo resultado para la misma entrada, con los mismos
mensajes y en el mismo orden.

## La estructura elegida y por qué

La decisión quedó como una **lista ordenada de reglas independientes**. Cada regla tiene
tres cosas:

| Parte | Qué es | Para qué sirve |
|---|---|---|
| `id` | Un nombre corto y estable (`falta-seguro`, `horas-insuficientes`) | Para citarla en la documentación, en los mensajes y en las revisiones. |
| `cuando` | Un predicado sobre la entrada completa | Dice en qué situación aplica la regla. |
| `decidir` | El resultado de la regla: un nivel y una lista de motivos | Dice qué pasa cuando la regla aplica. |

Tres reglas de lectura:

1. **Gana la primera que aplica.** Se recorre la lista de arriba hacia abajo y se corta en
   la primera regla cuyo `cuando` da verdadero. **El orden de la lista es la prioridad.**
2. **Cada regla es independiente.** Su predicado se evalúa contra la entrada completa; no
   depende de la regla anterior ni de variables compartidas. Lo que hace el orden es
   decidir *cuándo* se considera cada regla, no *qué sabe* cada regla.
3. **La lista es exhaustiva.** La última regla (`acreditado`) siempre aplica y cubre el
   caso de que nada falle.

`calculateAccreditationStatus` quedó como un orquestador finito: calcula el porcentaje,
busca la primera regla que aplica y devuelve su decisión. Toda la lógica de negocio está
en la lista de reglas.

### Por qué una lista y no otra forma

- **Se lee de arriba hacia abajo como el criterio de la resolución.** Antes, la prioridad
  estaba escondida en la forma del `if` anidado (el `else` de afuera era el caso "normal"
  y el orden de los if internos era la prioridad real). Ahora la prioridad es el orden de
  la lista, que es lo primero que se lee.
- **Agregar una regla no obliga a tocar las existentes.** Se inserta una entrada en la
  lista y nada más. Antes, una regla nueva exigía meterla dentro de un `if` anidado y
  decidir en qué nivel del árbol encajaba, con riesgo de descolocar el orden de los
  mensajes.
- **Cada regla se puede revisar sola.** El `id`, el `cuando` y el `decidir` de una regla
  dicen todo lo que esa regla hace. La complejidad que el linter marcaba (17 en
  `complexity`, 84 en `sonarjs/cognitive-complexity`) desaparece sola con esta estructura:
  no hizo falta desactivar ninguna regla de ESLint.

## Las reglas, en orden

Orden de evaluación: de la primera fila a la última. Gana la primera fila que aplica.
Los motivos se listan en el orden en que se muestran.

| # | `id` | Aplica cuando | Nivel | Motivos |
|---|---|---|---|---|
| 1 | `placement-abandonado` | El placement está `ABANDONED` | NO_ACREDITADO | `placement abandonado` y, si hay horas pendientes, `hay N horas pendientes sin revisar` |
| 2 | `placement-suspendido` | El placement está `SUSPENDED` | NO_ACREDITADO | `placement suspendido` y, si hay convenio, `convenio vigente pese a la suspensión` |
| 3 | `horas-insuficientes` | Las horas aprobadas no alcanzan las requeridas | PENDIENTE | `horas insuficientes` y, si hay horas pendientes, `hay N horas pendientes de aprobación` |
| 4 | `falta-convenio` | No hay convenio validado | NO_ACREDITADO | `falta convenio` y, si hay seguro, `seguro vigente pese a la falta de convenio` |
| 5 | `falta-seguro` | No hay seguro validado | NO_ACREDITADO | `falta seguro` y, si hay horas pendientes, `hay N horas pendientes de aprobación` |
| 6 | `falta-informe-final` | No hay informe final | PENDIENTE | `falta informe final` |
| 7 | `falta-evaluacion-del-tutor` | No hay evaluación del tutor | PENDIENTE | `falta evaluación del tutor` |
| 8 | `evaluacion-del-tutor-baja` | La evaluación del tutor existe pero es menor que 3 | NO_ACREDITADO | `evaluación del tutor por debajo del mínimo` y `informe final entregado pese a evaluación baja` |
| 9 | `evaluacion-de-la-empresa-baja` | La evaluación de la empresa no existe o es menor que 3 | ACREDITADO_CON_OBSERVACIONES | `falta evaluación de la empresa o es baja` |
| 10 | `acreditado` | Nada de lo anterior aplica | ACREDITADO | (sin motivos) |

### Cómo se leen las filas

Las filas se consideran **de arriba hacia abajo**, y las filas siguientes a una dada solo
se consideran si las anteriores no aplican. Por ejemplo:

- `falta-convenio` (fila 4) solo se considera cuando el placement no está abandonado ni
  suspendido (filas 1 y 2) y las horas están completas (fila 3). Si además de eso falta el
  seguro, la fila 4 gana y el resultado es `NO_ACREDITADO` por `falta convenio`.
- `evaluacion-del-tutor-baja` (fila 8) solo se alcanza con horas, convenio, seguro e
  informe final resueltos, porque cada requisito anterior tiene su propia fila.
- `evaluacion-de-la-empresa-baja` (fila 9) se evalúa con la nota del tutor ya aprobada
  (o con observación en la fila 8), porque la fila 8 corta antes.

El mensaje `informe final entregado pese a evaluación baja` se emite siempre junto a
`evaluación del tutor por debajo del mínimo`: la fila 8 solo se alcanza cuando el informe
final ya está entregado.

### Lo que no cambió

- Los cuatro niveles: `ACREDITADO`, `ACREDITADO_CON_OBSERVACIONES`, `PENDIENTE`,
  `NO_ACREDITADO`.
- Los mensajes de negocio y su orden dentro de `reasons`.
- El porcentaje de completitud: `Math.round((horasAprobadas / horasRequeridas) * 100)`,
  tal cual, incluido el `NaN` que resulta cuando las horas requeridas son 0.
- El contrato público: `AccreditationInput`, `AccreditationLevel`, `AccreditationResult` y
  la firma `calculateAccreditationStatus(input)`. El único consumidor es
  `src/placement/accreditation.service.ts` (el que arma el reporte de acreditación), y no
  se tocó.

## Cómo agregar una regla nueva

1. Escribí la regla en el formato `{ id, cuando, decidir }` e insertala en
   `REGLAS_DE_ACREDITACION`, en la posición que corresponda según la prioridad que
   querés. La posición importa: la regla que va antes gana.
2. Definí `cuando` con **todas** las condiciones que hacen falta para que la regla
   corresponda (por ejemplo, "no hay seguro y el placement está activo"). La regla se
   evalúa sola; no hace falta que otras reglas le avisen nada.
3. Definí `decidir` con el nivel y los motivos, en el orden en que deben mostrarse.
4. Agregá el caso a `src/placement/accreditation.spec.ts` (los tests de caracterización
   de E5-01) y corré `pnpm exec vitest run src/placement/accreditation.spec.ts`.

No hay que modificar ninguna regla existente, ni la función `calculateAccreditationStatus`,
ni el contrato público.

## Cómo verificar

```bash
export DATABASE_URL='postgresql://practicas:practicas@localhost:5432/e5_02_issue_1792633111?schema=public'
pnpm exec vitest run src/placement/accreditation.spec.ts
pnpm exec eslint src/placement/accreditation.ts
pnpm typecheck
pnpm test
pnpm build
```

Los 16 tests de caracterización de E5-01 pasan sin modificación del archivo de tests, y
el archivo de `accreditation.ts` queda sin hallazgos de ESLint (antes: complejidad 17 y
84 de complejidad cognitiva, más un dead store y tres asignaciones redundantes).
