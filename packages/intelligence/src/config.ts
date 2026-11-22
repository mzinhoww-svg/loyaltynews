// Flag de dado pessoal ampliado: desligada por padrão (DP-11 P4; ADR-009; J-01 aberto).
// A flag oficial deve viver em packages/contracts/flags.ts (Chief Architect); aqui só a configuração local.
export interface IntelligenceConfig {
  /** Habilita atributos pessoais além de nome, cargo e empresa. Default false; também travada no banco. */
  extendedPersonalData: boolean;
}
export const DEFAULT_CONFIG: IntelligenceConfig = Object.freeze({ extendedPersonalData: false });

export class ExtendedPersonalDataDisabledError extends Error {
  constructor(readonly fields: string[]) {
    super(`extended_personal_data_disabled: ${fields.join(', ')}`);
  }
}
export class EvidenceRequiredError extends Error {
  constructor(what: string) {
    super(`evidence_required: ${what}`);
  }
}
