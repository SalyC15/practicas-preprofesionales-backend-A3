import { describe, expect, it } from 'vitest'
import { calculateAccreditationStatus } from './accreditation'

const base = {
  placementId: 1,
  studentName: 'Estudiante 0',
  requiredHours: 240,
  approvedHours: 240,
  pendingHours: 0,
  hasAgreement: true,
  hasInsurance: true,
  hasFinalReport: true,
  tutorEvaluationScore: 4.5,
  companyEvaluationScore: 4.2,
  placementStatus: 'COMPLETED',
}

const cases = [
  { name: 'accredits when hours, documents and both evaluations meet the rules', input: {}, level: 'ACREDITADO', reasons: [], completionPercentage: 100 },
  { name: 'adds observations when the company evaluation is missing', input: { companyEvaluationScore: null }, level: 'ACREDITADO_CON_OBSERVACIONES', reasons: ['falta evaluación de la empresa o es baja'], completionPercentage: 100 },
  { name: 'adds observations when the company evaluation is below 3', input: { companyEvaluationScore: 2.9 }, level: 'ACREDITADO_CON_OBSERVACIONES', reasons: ['falta evaluación de la empresa o es baja'], completionPercentage: 100 },
  { name: 'keeps pending when hours are insufficient and none await review', input: { approvedHours: 120, pendingHours: 0, placementStatus: 'ACTIVE' }, level: 'PENDIENTE', reasons: ['horas insuficientes'], completionPercentage: 50 },
  { name: 'includes awaiting hours when hours are insufficient', input: { approvedHours: 120, pendingHours: 40, placementStatus: 'ACTIVE' }, level: 'PENDIENTE', reasons: ['horas insuficientes', 'hay 40 horas pendientes de aprobación'], completionPercentage: 50 },
  { name: 'keeps pending when the final report is missing', input: { hasFinalReport: false }, level: 'PENDIENTE', reasons: ['falta informe final'], completionPercentage: 100 },
  { name: 'keeps pending when the tutor evaluation is missing', input: { tutorEvaluationScore: null }, level: 'PENDIENTE', reasons: ['falta evaluación del tutor'], completionPercentage: 100 },
  { name: 'does not accredit an abandoned placement without pending hours', input: { placementStatus: 'ABANDONED' }, level: 'NO_ACREDITADO', reasons: ['placement abandonado'], completionPercentage: 100 },
  { name: 'includes unreviewed hours for an abandoned placement', input: { placementStatus: 'ABANDONED', pendingHours: 12 }, level: 'NO_ACREDITADO', reasons: ['placement abandonado', 'hay 12 horas pendientes sin revisar'], completionPercentage: 100 },
  { name: 'does not add an agreement reason to a suspended placement without agreement', input: { placementStatus: 'SUSPENDED', hasAgreement: false }, level: 'NO_ACREDITADO', reasons: ['placement suspendido'], completionPercentage: 100 },
  { name: 'reports an active agreement on a suspended placement', input: { placementStatus: 'SUSPENDED', hasAgreement: true }, level: 'NO_ACREDITADO', reasons: ['placement suspendido', 'convenio vigente pese a la suspensión'], completionPercentage: 100 },
  { name: 'does not accredit without an agreement or insurance', input: { hasAgreement: false, hasInsurance: false }, level: 'NO_ACREDITADO', reasons: ['falta convenio'], completionPercentage: 100 },
  { name: 'reports active insurance when the agreement is missing', input: { hasAgreement: false, hasInsurance: true }, level: 'NO_ACREDITADO', reasons: ['falta convenio', 'seguro vigente pese a la falta de convenio'], completionPercentage: 100 },
  { name: 'does not accredit without insurance and no pending hours', input: { hasInsurance: false, pendingHours: 0 }, level: 'NO_ACREDITADO', reasons: ['falta seguro'], completionPercentage: 100 },
  { name: 'includes awaiting hours when insurance is missing', input: { hasInsurance: false, pendingHours: 8 }, level: 'NO_ACREDITADO', reasons: ['falta seguro', 'hay 8 horas pendientes de aprobación'], completionPercentage: 100 },
  { name: 'does not accredit when the tutor evaluation is below 3', input: { tutorEvaluationScore: 2.9 }, level: 'NO_ACREDITADO', reasons: ['evaluación del tutor por debajo del mínimo', 'informe final entregado pese a evaluación baja'], completionPercentage: 100 },
] as const

describe('calculateAccreditationStatus characterization rules (E5-01)', () => {
  it.each(cases)('$name', ({ input, level, reasons, completionPercentage }) => {
    const result = calculateAccreditationStatus({ ...base, ...input })

    expect(result).toEqual({
      placementId: base.placementId,
      studentName: base.studentName,
      level,
      reasons,
      completionPercentage,
    })
  })
})
