// Consentimento por finalidade (J-15). Regra do protótipo, a ser CONFIRMADA no parecer jurídico (R0-10/J-15):
//  - `medicao_agregada`: contagem própria, sem cookie, sem identificador, sem dado pessoal. Não depende de consentimento no
//    desenho proposto (base candidata: legítimo interesse, a confirmar), mas respeita GPC/DNT e exige política publicada.
//  - `medicao_terceiros` (ex.: GA4, que grava cookie e envia dados a terceiro) e `publicidade`: só com consentimento
//    explícito, desligadas por padrão, nunca habilitadas de antemão, e só enquanto a versão da política consentida for a vigente.
//  - Qualquer finalidade desconhecida é negada.

export const PURPOSES = ['medicao_agregada', 'medicao_terceiros', 'publicidade'] as const;
export type Purpose = (typeof PURPOSES)[number];

/** Finalidades que exigem opt-in explícito. */
export const CONSENT_REQUIRED: readonly Purpose[] = ['medicao_terceiros', 'publicidade'];

export interface ConsentRecord {
  /** Versão da política de privacidade/cookies consentida. Consentimento de versão antiga não vale. */
  policyVersion: string;
  grantedAt: string;
  /** Escolha por finalidade. Ausente = não consentiu. */
  purposes: Partial<Record<Purpose, boolean>>;
}

export interface PrivacySignals {
  /** Global Privacy Control. */
  gpc?: boolean;
  /** Do Not Track. */
  dnt?: boolean;
}

export interface PrivacyPolicyState {
  /** Versão vigente publicada. Sem política publicada, só a medição agregada própria é admitida, e mesmo ela fica desligada pela flag. */
  currentVersion: string | null;
}

/** `true` se o sinal do navegador pede para não ser medido. */
export function optedOutBySignal(s: PrivacySignals | undefined): boolean {
  return s?.gpc === true || s?.dnt === true;
}

/**
 * Pode usar a finalidade? `medicao_agregada` não exige consentimento, mas é barrada por sinal GPC/DNT e por falta de política
 * publicada. As demais exigem consentimento explícito, da versão vigente, e também são barradas por GPC/DNT.
 */
export function canUse(purpose: string, args: { consent?: ConsentRecord | null; signals?: PrivacySignals; policy: PrivacyPolicyState }): boolean {
  if (!(PURPOSES as readonly string[]).includes(purpose)) return false;
  if (optedOutBySignal(args.signals)) return false;
  if (!args.policy.currentVersion) return false;
  if (purpose === 'medicao_agregada') return true;
  const c = args.consent;
  if (!c || c.policyVersion !== args.policy.currentVersion) return false;
  return c.purposes[purpose as Purpose] === true;
}

export interface ThirdPartyFlags {
  /** Medição de terceiros (ex.: GA4). Desligada por padrão; não existe em @ln/contracts (proposta ao Chief Architect). */
  analyticsThirdParty: boolean;
}

export const DEFAULT_THIRD_PARTY_FLAGS: Readonly<ThirdPartyFlags> = Object.freeze({ analyticsThirdParty: false });

/**
 * Porta única para qualquer carregamento de script de terceiros de medição: exige flag ligada E consentimento válido da
 * finalidade `medicao_terceiros`. Este pacote NÃO carrega nada externo: a função só responde sim ou não.
 */
export function thirdPartyMeasurementAllowed(args: {
  flags: ThirdPartyFlags;
  consent?: ConsentRecord | null;
  signals?: PrivacySignals;
  policy: PrivacyPolicyState;
}): boolean {
  if (args.flags.analyticsThirdParty !== true) return false;
  return canUse('medicao_terceiros', args);
}
