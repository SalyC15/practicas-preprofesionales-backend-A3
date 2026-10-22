# E5-01: reglas actuales de acreditación

Pruebas de caracterización de calculateAccreditationStatus. La tabla fija el resultado actual de la función para cada entrada; no declara reglas nuevas ni cambia su comportamiento.

| Entrada / condición evaluada | Resultado esperado | Razones actuales |
|---|---|---|
| Abandonada; 0 horas pendientes de revisión | NO_ACREDITADO | placement abandonado |
| Abandonada; horas pendientes > 0 | NO_ACREDITADO | Abandono y cantidad de horas pendientes sin revisar |
| Suspendida; sin convenio | NO_ACREDITADO | placement suspendido |
| Suspendida; con convenio | NO_ACREDITADO | Suspensión y convenio vigente pese a la suspensión |
| Estado normal; horas aprobadas < requeridas; sin pendientes | PENDIENTE | horas insuficientes |
| Estado normal; horas aprobadas < requeridas; con pendientes | PENDIENTE | Horas insuficientes y cantidad pendiente de aprobación |
| Horas completas; sin convenio ni seguro | NO_ACREDITADO | falta convenio |
| Horas completas; sin convenio y con seguro | NO_ACREDITADO | Falta de convenio y seguro vigente pese a esa falta |
| Horas completas; con convenio, sin seguro y sin pendientes | NO_ACREDITADO | falta seguro |
| Horas completas; con convenio, sin seguro y con pendientes | NO_ACREDITADO | Falta de seguro y cantidad pendiente de aprobación |
| Horas y documentos completos; sin informe final | PENDIENTE | falta informe final |
| Horas y documentos completos; sin evaluación del tutor | PENDIENTE | falta evaluación del tutor |
| Evaluación del tutor < 3 | NO_ACREDITADO | Evaluación por debajo del mínimo e informe final entregado pese a evaluación baja |
| Tutor >= 3; evaluación de empresa ausente | ACREDITADO_CON_OBSERVACIONES | falta evaluación de la empresa o es baja |
| Tutor >= 3; evaluación de empresa < 3 | ACREDITADO_CON_OBSERVACIONES | falta evaluación de la empresa o es baja |
| Horas, documentos y ambas evaluaciones >= 3 | ACREDITADO | Sin razones |

En todas las filas, el porcentaje es round(horas aprobadas / horas requeridas * 100). El estado ABANDONED se evalúa antes que SUSPENDED; ambos se evalúan antes que horas, documentos y evaluaciones.

