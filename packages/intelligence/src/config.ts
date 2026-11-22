import { isEnabled, type FlagState } from '@ln/contracts/flags';

/**
 * Configuração do Intelligence. As duas chaves de dado pessoal nascem DESLIGADAS (DP-11 P4; ADR-009; J-01 aberto).
 *  - personIngestion: ingestão de pessoas (nome + cargo + empresa de fonte pública). Espelha a flag `intelligencePessoas`
 *    de @ln/contracts (única fonte das flags; não duplicar). Desligada: nenhuma pessoa é criada ou atualizada.
 *  - extendedPersonalData: qualquer atributo além de nome/cargo/empresa. Sem flag no contrato (não deve ser ligada
 *    sem decisão do proprietário); também travada no banco por gatilho.
 */
export interface IntelligenceConfig {
  personIngestion: boolean;
  extendedPersonalData: boolean;
}
export const DEFAULT_CONFIG: IntelligenceConfig = Object.freeze({ personIngestion: false, extendedPersonalData: false });

/** Deriva a configuração das flags do produto (overrides só por decisão registrada). */
export function configFromFlags(overrides: Partial<FlagState> = {}): IntelligenceConfig {
  return { personIngestion: isEnabled('intelligencePessoas', overrides), extendedPersonalData: false };
}

export class PersonIngestionDisabledError extends Error {
  constructor() {
    super('person_ingestion_disabled');
  }
}
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
export class PersonSuppressedError extends Error {
  constructor() {
    super('person_suppressed');
  }
}
