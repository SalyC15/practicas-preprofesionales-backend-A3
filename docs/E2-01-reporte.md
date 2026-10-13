# E2-01 — Spike: sobrecupo con aceptaciones concurrentes

## Resumen
Se confirma que el sistema permite aceptar más postulaciones que cupos
disponibles cuando dos aceptaciones llegan al mismo tiempo. El test
`application.overbooking.spec.ts` lo reproduce de forma 100% determinista.

## Dónde está la ventana (TOCTOU)

Archivo: `src/application/application.service.ts`, método `decide()`.

- **Línea 54** — lectura (check): `const accepted = await this.offers.acceptedCount(application.offerId)`
- **Línea 55** — validación sobre esa lectura: `if (accepted >= offer.seats) throw ...`
- **Líneas 58–61** — escritura (use): `this.prisma.application.update({ where: { id }, data: { status, ... } })`

Entre la lectura (línea 54) y la escritura (línea 58) no hay ningún bloqueo:
cualquier otra petición puede colarse, leer el mismo conteo desactualizado,
y pasar su propia validación.

## Secuencia del fallo

```
Hilo A (postulación 1)                    Hilo B (postulación 2)
----------------------------------------  ----------------------------------------
1. acceptedCount(offerId) -> 0
   (0 < seats=1 → pasa validación)
                                           2. acceptedCount(offerId) -> 0   <- ventana TOCTOU
                                              (0 < seats=1 → pasa validación)
3. UPDATE application A -> ACCEPTED
                                           4. UPDATE application B -> ACCEPTED

Resultado: 2 aceptados sobre una oferta de 1 cupo.
```

## Cómo el test lo demuestra sin depender de suerte

Un `Promise.all` simple sobre dos llamadas a `decide()` no garantiza que
ambas lean el conteo antes de que una escriba — el resultado dependería del
orden real de respuesta de PostgreSQL y el test sería intermitente.

Para eliminar esa dependencia del azar, se intercepta `OfferService.acceptedCount`
con un espía que:
1. Deja que la lectura real a la base de datos ocurra normalmente.
2. Cuenta cuántas veces se invocó.
3. Bloquea el retorno de **ambas** llamadas hasta que las dos ya leyeron.
4. Libera ambas a la vez — garantizando que las dos pasan la validación
   antes de que cualquiera escriba.

Esto reproduce la ventana TOCTOU en el 100% de las corridas, sin `sleep` ni
reintentos.

## Alcance confirmado
El problema es específico a `Application.decide()` sobre `Offer.seats`. No se
evaluó si otros flujos del sistema (por ejemplo `Placement`) tienen el mismo
patrón de lectura-luego-escritura sin bloqueo; se recomienda revisarlo aparte.

## Recomendación para E2-02 (fuera de alcance de este spike)
- Opción A: transacción con bloqueo pesimista (`SELECT ... FOR UPDATE` sobre
  la oferta) antes de contar y decidir.
- Opción B: una restricción a nivel de base de datos que haga el estado
  inválido imposible de alcanzar, en vez de depender solo del código de
  aplicación — más robusta ante llamadas directas a la API.
