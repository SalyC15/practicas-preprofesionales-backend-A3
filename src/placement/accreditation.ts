export interface AccreditationInput {
  placementId: number
  studentName: string
  requiredHours: number
  approvedHours: number
  pendingHours: number
  hasAgreement: boolean
  hasInsurance: boolean
  hasFinalReport: boolean
  tutorEvaluationScore: number | null
  companyEvaluationScore: number | null
  placementStatus: string
}

export type AccreditationLevel =
  | 'ACREDITADO'
  | 'ACREDITADO_CON_OBSERVACIONES'
  | 'PENDIENTE'
  | 'NO_ACREDITADO'

export interface AccreditationResult {
  placementId: number
  studentName: string
  level: AccreditationLevel
  reasons: string[]
  completionPercentage: number
}

/** Resultado de aplicar una regla: nivel asignado y motivos (texto de negocio). */
interface AccreditationDecision {
  nivel: AccreditationLevel
  motivos: string[]
}

/**
 * Regla de acreditación.
 *
 * - `id`: identificador de la regla, para trazabilidad y para documentarla.
 * - `cuando`: predicado de aplicación. Se evalúa contra la entrada completa.
 * - `decidir`: devuelve el nivel y los motivos cuando la regla aplica.
 */
interface AccreditationRule {
  id: string
  cuando: (input: AccreditationInput) => boolean
  decidir: (input: AccreditationInput) => AccreditationDecision
}

/** Las horas aprobadas alcanzan las requeridas. */
function horasCompletas(input: AccreditationInput): boolean {
  return input.approvedHours >= input.requiredHours
}

/** Hay evaluación del tutor y la nota alcanza el mínimo de 3. */
function tutorAprobado(input: AccreditationInput): boolean {
  return input.tutorEvaluationScore !== null && input.tutorEvaluationScore >= 3
}

/** Hay evaluación de la empresa y la nota alcanza el mínimo de 3. */
function empresaAprobada(input: AccreditationInput): boolean {
  return input.companyEvaluationScore !== null && input.companyEvaluationScore >= 3
}

/**
 * Mensaje de horas pendientes de aprobación. Lo usan las reglas de horas
 * insuficientes y de seguro faltante; el texto de negocio no cambia.
 */
function horasPendientesDeAprobacion(input: AccreditationInput): string[] {
  return input.pendingHours > 0 ? [`hay ${input.pendingHours} horas pendientes de aprobación`] : []
}

/**
 * Regla final: si ninguna regla anterior aplicó, el placement cumple todos los
 * requisitos y queda acreditado. Su predicado siempre es verdadero, así que la
 * lista es exhaustiva.
 */
const REGLA_ACREDITADO: AccreditationRule = {
  id: 'acreditado',
  cuando: () => true,
  decidir: () => ({ nivel: 'ACREDITADO', motivos: [] }),
}

/**
 * Lista ORDENADA de reglas de acreditación. Gana la PRIMERA que aplica y el
 * orden de la lista ES la prioridad.
 *
 * Cada regla es independiente: su predicado se evalúa contra la entrada
 * completa y ninguna depende de otra ni de estado mutable compartido. Por eso
 * las reglas siguientes a una dada solo se consideran cuando las anteriores no
 * aplican (por ejemplo, "falta convenio" solo se considera cuando las horas
 * están completas).
 *
 * Para agregar una regla nueva alcanza con insertar una entrada en esta lista:
 * no hay que tocar las reglas existentes.
 */
const REGLAS_DE_ACREDITACION: AccreditationRule[] = [
  {
    id: 'placement-abandonado',
    cuando: (input) => input.placementStatus === 'ABANDONED',
    decidir: (input) => ({
      nivel: 'NO_ACREDITADO',
      motivos: [
        'placement abandonado',
        ...(input.pendingHours > 0 ? [`hay ${input.pendingHours} horas pendientes sin revisar`] : []),
      ],
    }),
  },
  {
    id: 'placement-suspendido',
    cuando: (input) => input.placementStatus === 'SUSPENDED',
    decidir: (input) => ({
      nivel: 'NO_ACREDITADO',
      motivos: [
        'placement suspendido',
        ...(input.hasAgreement ? ['convenio vigente pese a la suspensión'] : []),
      ],
    }),
  },
  {
    id: 'horas-insuficientes',
    cuando: (input) => !horasCompletas(input),
    decidir: (input) => ({
      nivel: 'PENDIENTE',
      motivos: ['horas insuficientes', ...horasPendientesDeAprobacion(input)],
    }),
  },
  {
    id: 'falta-convenio',
    cuando: (input) => !input.hasAgreement,
    decidir: (input) => ({
      nivel: 'NO_ACREDITADO',
      motivos: [
        'falta convenio',
        ...(input.hasInsurance ? ['seguro vigente pese a la falta de convenio'] : []),
      ],
    }),
  },
  {
    id: 'falta-seguro',
    cuando: (input) => !input.hasInsurance,
    decidir: (input) => ({
      nivel: 'NO_ACREDITADO',
      motivos: ['falta seguro', ...horasPendientesDeAprobacion(input)],
    }),
  },
  {
    id: 'falta-informe-final',
    cuando: (input) => !input.hasFinalReport,
    decidir: () => ({
      nivel: 'PENDIENTE',
      motivos: ['falta informe final'],
    }),
  },
  {
    id: 'falta-evaluacion-del-tutor',
    cuando: (input) => input.tutorEvaluationScore === null,
    decidir: () => ({
      nivel: 'PENDIENTE',
      motivos: ['falta evaluación del tutor'],
    }),
  },
  {
    id: 'evaluacion-del-tutor-baja',
    cuando: (input) => input.tutorEvaluationScore !== null && !tutorAprobado(input),
    decidir: (input) => ({
      nivel: 'NO_ACREDITADO',
      motivos: [
        'evaluación del tutor por debajo del mínimo',
        ...(input.hasFinalReport ? ['informe final entregado pese a evaluación baja'] : []),
      ],
    }),
  },
  {
    id: 'evaluacion-de-la-empresa-baja',
    cuando: (input) => !empresaAprobada(input),
    decidir: () => ({
      nivel: 'ACREDITADO_CON_OBSERVACIONES',
      motivos: ['falta evaluación de la empresa o es baja'],
    }),
  },
  REGLA_ACREDITADO,
]

/**
 * Calcula el nivel de acreditación de un placement.
 *
 * Orquesta la lista de reglas: calcula el porcentaje de completitud, busca la
 * PRIMERA regla que aplica y devuelve su decisión. El porcentaje se calcula
 * siempre, incluso cuando `requiredHours` es 0 (da NaN, tal como antes).
 */
export function calculateAccreditationStatus(input: AccreditationInput): AccreditationResult {
  const percentage = Math.round((input.approvedHours / input.requiredHours) * 100)
  const regla = REGLAS_DE_ACREDITACION.find((candidata) => candidata.cuando(input)) ?? REGLA_ACREDITADO
  const decision = regla.decidir(input)

  return {
    placementId: input.placementId,
    studentName: input.studentName,
    level: decision.nivel,
    reasons: decision.motivos,
    completionPercentage: percentage,
  }
}
