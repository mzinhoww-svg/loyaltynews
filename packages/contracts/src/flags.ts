/**
 * Feature flags do produto. TODAS desligadas por padrão (fast-track, regra 3).
 * Ligar uma flag é decisão registrada (gate, ato do proprietário ou mudança protegida), nunca default de código.
 */
export const FLAG_DEFAULTS = {
  /** Instagram construído e desligado (D05; ligar = P-02). */
  instagram: false,
  /** The Loyal (newsletter) construída e desligada (D05; ligar = P-01). */
  theLoyal: false,
  /** Publicação autônoma no portal, só após gates de R6 (D06). */
  publicacaoAutonoma: false,
  /** Registro de publicação no portal disparado pelo CMS/Studio (sessão autenticada com MFA), após os gates automáticos (ADR-017). */
  publicacaoPortal: false,
  /** Publicação no LinkedIn via mLabs (R5-02). */
  linkedinPublicacao: false,
  /** Ingestão de pessoas no Intelligence (J-01: parecer, controlador, processador). */
  intelligencePessoas: false,
  /** Venda no ad server / formatos disponíveis (CP-12). */
  adServerVendas: false,
  /** Checkout de planos pagos (R5-14: PJ e meio de pagamento). */
  planosPagos: false,
  /** Chamadas de modelo em produção (model.policy production_enabled=false). */
  modelosHabilitados: false,
  /** Rótulo de conteúdo gerado por IA, pronto e desligado (D09). */
  rotulagemIa: false,
  /** Retargeting e tracking que exige consentimento. */
  retargeting: false,
  /** Rituais da organização agêntica (ativam após o gate R4). */
  rituais: false,
  /** Coleta de analytics (J-15: política publicada e consentimento por finalidade). */
  analytics: false,
  /** Portal: Market Data (estado de disponibilidade, Blueprint §1). */
  portalMarketData: false,
  /** Portal: Podcast / Loyalty Talks. */
  portalPodcast: false,
  /** Portal: formulários públicos (contato, mídia kit, newsletter). */
  portalFormularios: false,
  /** Fábrica editorial: coletor determinístico de fontes (ADR-007). */
  editorialCollector: false,
  /** Fábrica editorial: pipeline de redação e checagem (WF01/WF02). */
  editorialPipeline: false,
  /** Despacho de tarefas ao OpenBot pelo adaptador `@ln/openbot` (ADR-003, R2-10; protocolo em packages/openbot/docs/PROTOCOL.md). */
  openbotDispatch: false,
} as const satisfies Record<string, false>;

export type FlagName = keyof typeof FLAG_DEFAULTS;
export type FlagState = Record<FlagName, boolean>;

/** Resolve uma flag. Sem override explícito, vale o default (desligado). */
export function isEnabled(name: FlagName, overrides: Partial<FlagState> = {}): boolean {
  return overrides[name] ?? FLAG_DEFAULTS[name];
}
