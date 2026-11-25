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
  /** Leitores externos por provedor (DP-32; DP-36: Bright Data com uma conta). Liga o createReader do @ln/intelligence só pelo resolvedor (ADR-022, adendo 2). */
  leitorViaProvedor: false,
} as const satisfies Record<string, false>;

export type FlagName = keyof typeof FLAG_DEFAULTS;
export type FlagState = Record<FlagName, boolean>;

/** Resolve uma flag. Sem override explícito, vale o default (desligado). */
export function isEnabled(name: FlagName, overrides: Partial<FlagState> = {}): boolean {
  return overrides[name] ?? FLAG_DEFAULTS[name];
}

// ── ADR-022: flags de produto ligadas por ambiente e por decisão registrada (condições N1–N9 do Security, doc 18) ──

/** Formato de id de decisão aceito no registro (N5). Placeholder não passa. */
export const DECISION_ID = /^DP-\d{2,3}$/;

export type FlagRelease = { staging: string | null; production: string | null };

/**
 * Registro de liberação. Uma flag só liga num ambiente com o id da decisão aqui.
 * Produção: só por commit revisado que preencha `production` E ponha a flag em PRODUCTION_FLAGS_ON; o id tem de existir em
 * governance/decisions.yaml (N6, teste do contrato).
 */
export const FLAG_RELEASES = {
  intelligencePessoas: { staging: 'DP-38', production: null }, // produção só no go-live (outra mudança registrada)
  openbotDispatch: { staging: 'DP-41', production: null },
  leitorViaProvedor: { staging: 'DP-32', production: null }, // ADR-022 adendo 2: provedores de desbloqueio em páginas públicas, só staging // piloto só no staging, só assinaturas, sem API tarifada nem publicação
  adServerVendas: { staging: 'DP-43', production: null }, // venda de anúncios só no staging (DP-43); produção só no go-live, com nova decisão do proprietário
  portalFormularios: { staging: 'DP-57', production: 'DP-57' }, // formulário de proposta (DP-57): produção por commit (PRODUCTION_FLAGS_ON); staging por LN_FLAGS_ON, para ensaiar antes
} as const satisfies Partial<Record<FlagName, FlagRelease>>;

/**
 * ADR-022, ligação em PRODUÇÃO por commit revisado (DP-57). As flags desta lista ligam em APP_ENV=production SEM variável de ambiente:
 * o conjunto é código, entra por PR revisado e vale para o commit implantado (o /api/health mostra o resultado).
 * Regras (falha fechada no resolveFlags): cada nome precisa de FLAG_RELEASES[nome].production com id DP-NN(N) válido; sem ele, a subida
 * em produção é recusada. LN_FLAGS_ON continua proibida em produção (guard-env e resolvedor). Não vale fora de production (local, CI, staging).
 * adServerVendas fica FORA (DP-43 só vale para o staging; DP-57 a mantém desligada em produção).
 */
export const PRODUCTION_FLAGS_ON = ['portalFormularios'] as const satisfies readonly FlagName[];

/** Hosts públicos da produção (N7). Preenchido quando o domínio existir. */
export const PRODUCTION_HOSTS: readonly string[] = [];

export type FlagEnv = 'staging' | 'production';

export interface ResolvedFlags {
  /** Ambiente efetivo; null = local/ci/ausente (nada liga). */
  ambiente: FlagEnv | null;
  state: FlagState;
  /** Nomes ligados (para /api/health): em produção, os de PRODUCTION_FLAGS_ON; no staging, na ordem de LN_FLAGS_ON. */
  on: FlagName[];
  /** Linha de log da subida, ex.: "flags ligadas: intelligencePessoas (DP-38, staging)". */
  logLine: string;
  /** Avisos (ex.: LN_FLAGS_ON preenchida fora de staging/produção). */
  warnings: string[];
}

const MAX_FLAGS_INPUT = 512;
const SAFE_NAME = /^[A-Za-z]{1,40}$/;

/** APP_ENV → ambiente de flags (N3): trim + lower; `staging`; `production`/`producao`; outro valor = null. */
export function flagEnvFrom(appEnv: string | undefined): FlagEnv | null {
  const v = (appEnv ?? '').trim().toLowerCase();
  if (v === 'staging') return 'staging';
  if (v === 'production' || v === 'producao') return 'production';
  return null;
}

function isFlagName(n: string): n is FlagName {
  return Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, n);
}

function releaseOf(name: FlagName, amb: FlagEnv): string | null {
  const r = (FLAG_RELEASES as Partial<Record<FlagName, FlagRelease>>)[name];
  const id = r ? r[amb] : null;
  return typeof id === 'string' && DECISION_ID.test(id) ? id : null;
}

/**
 * Valida uma lista de ligação por commit em produção (pura; resolveFlags usa PRODUCTION_FLAGS_ON). Falha fechada: nome desconhecido
 * ou sem FLAG_RELEASES[nome].production válido lança Error citando só o nome. Repetidos contam uma vez. Exportada para teste.
 */
export function productionFlagsByCommit(lista: readonly string[]): { nome: FlagName; decisao: string }[] {
  const out: { nome: FlagName; decisao: string }[] = [];
  for (const n of lista) {
    if (!isFlagName(n)) throw new Error(`Subida recusada: PRODUCTION_FLAGS_ON com flag desconhecida ${SAFE_NAME.test(n) ? n : 'nome inválido'} (ADR-022)`);
    const decisao = releaseOf(n, 'production');
    if (!decisao) throw new Error(`Subida recusada: flag ${n} em PRODUCTION_FLAGS_ON sem decisão para production (ADR-022)`);
    if (out.some((x) => x.nome === n)) continue;
    out.push({ nome: n, decisao });
  }
  return out;
}

function hostOf(url: string | undefined): string | null {
  if (!url || !url.trim()) return null;
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resolve as flags de produto a partir do ambiente (função pura, ADR-022). Falha fechada: lança Error com mensagem
 * que cita só o nome da flag (ou "nome inválido") e o ambiente, nunca o valor bruto de LN_FLAGS_ON (N4).
 */
export function resolveFlags(env: Record<string, string | undefined>): ResolvedFlags {
  const state: FlagState = { ...FLAG_DEFAULTS };
  const raw = env.LN_FLAGS_ON ?? '';
  const ambiente = flagEnvFrom(env.APP_ENV);
  const warnings: string[] = [];
  const empty = (logLine = 'flags ligadas: nenhuma'): ResolvedFlags => ({ ambiente, state, on: [], logLine, warnings });

  if (ambiente === 'staging') {
    // N7: staging não pode ser a produção mal configurada.
    if (env.PORTAL_INDEXAVEL !== undefined) throw new Error('Subida recusada: modo staging com PORTAL_INDEXAVEL definida (ADR-022)');
    const h = hostOf(env.NEXT_PUBLIC_SITE_URL);
    if (h && PRODUCTION_HOSTS.map((x) => x.toLowerCase()).includes(h)) throw new Error('Subida recusada: modo staging com NEXT_PUBLIC_SITE_URL de produção (ADR-022)');
  }

  const on: FlagName[] = [];
  const parts: string[] = [];

  if (ambiente === 'production') {
    // DP-57: em produção a flag liga por commit (PRODUCTION_FLAGS_ON), nunca por variável. Cada nome precisa da decisão de produção.
    for (const { nome, decisao } of productionFlagsByCommit(PRODUCTION_FLAGS_ON)) {
      state[nome] = true;
      on.push(nome);
      parts.push(`${nome} (${decisao}, production, por commit)`);
    }
  }

  const resultado = (): ResolvedFlags => ({ ambiente, state, on, logLine: on.length ? `flags ligadas: ${parts.join(', ')}` : 'flags ligadas: nenhuma', warnings });

  if (!raw.trim()) return resultado();
  if (ambiente === null) {
    warnings.push('LN_FLAGS_ON ignorada: APP_ENV não é staging nem production (ADR-022)');
    return empty();
  }
  if (raw.length > MAX_FLAGS_INPUT) throw new Error(`Subida recusada: LN_FLAGS_ON acima de ${MAX_FLAGS_INPUT} caracteres (ADR-022)`);

  for (const item of raw.split(',')) {
    const n = item.trim();
    if (!n) continue;
    if (!isFlagName(n)) throw new Error(`Subida recusada: flag desconhecida ${SAFE_NAME.test(n) ? n : 'nome inválido'} em LN_FLAGS_ON (ADR-022)`);
    const decisao = releaseOf(n, ambiente);
    if (!decisao) throw new Error(`Subida recusada: flag ${n} sem decisão para ${ambiente} (ADR-022)`);
    // Produção: mesmo com decisão, a variável não liga nada (DP-57: só por commit, PRODUCTION_FLAGS_ON). O guard-env já recusa antes.
    if (ambiente === 'production') throw new Error(`Subida recusada: flag ${n} por LN_FLAGS_ON em production; em produção a flag liga só por commit (PRODUCTION_FLAGS_ON) (ADR-022)`);
    if (state[n]) continue;
    state[n] = true;
    on.push(n);
    parts.push(`${n} (${decisao}, ${ambiente})`);
  }
  return resultado();
}
