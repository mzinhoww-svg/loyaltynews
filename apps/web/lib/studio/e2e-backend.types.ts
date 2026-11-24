export interface E2eBackend {
  /** Usuário do papel com sessão real (cookies Set-Cookie do Better Auth). `mfa=false`: só senha, sem 2º fator. */
  login(user: string, role: string, mfa: boolean): Promise<{ id: string; setCookies: string[] }>;
  /** Conta de teste NOVA para o teste digitar no formulário de login: e-mail, senha e (com `totp`) o segredo base32 do aplicativo autenticador já ativo. Sem `totp`, a conta não tem 2º fator. */
  contaDeTeste(key: string, role: string, totp: boolean): Promise<{ email: string; senha: string; segredo: string | null }>;
  /** Semeia UMA matéria da Fábrica editorial (rascunho com 1 afirmação e 1 evidência, sem veredito) no banco de e2e. Idempotente. */
  seedEditorial(): Promise<{ articleId: string }>;
  /** Semeia UMA matéria da Fábrica APROVADA e pronta para recibo e publicação oficiais (checagem de outro provedor, todas as afirmações aprovadas). Devolve o rascunho para os testes montarem a correção. Idempotente. */
  seedEditorialAprovada(): Promise<{ articleId: string; draft: Record<string, unknown> }>;
  /** Semeia duas pautas autorais JÁ PROCESSADAS pelo worker (uma aprovada, uma bloqueada) na trilha de auditoria do e2e (MOCK: o worker não roda no e2e). Idempotente. */
  seedPautasProcessadas(): Promise<{ aprovada: string; bloqueada: string }>;
  /** Semeia o Entity Intelligence com dados MOCK pelas funções reais do pacote: empresas, cargos oficiais e secundário (a confirmar), uma relação e um Move detectado (antes/depois). Idempotente. */
  seedIntelligence(): Promise<{ alfa: string; beta: string; pessoa: string; bruno: string; carla: string }>;
  /** Gera os alertas das watchlists sobre os Moves já existentes (função real generateAlerts; o worker não roda no e2e). Idempotente. */
  seedAlertasWatchlist(): Promise<{ gerados: number }>;
  /** Semeia dois artigos MOCK (sampleArticle da Editorial) para a leitura do piloto; o mapa a1/a2 é fixado pelo teste. Idempotente. */
  seedPilotoArtigos(): Promise<{ artigos: string[] }>;
  /** Duas linhas MOCK da trilha do piloto com parada imediata (segredo em log; ferramenta fora do contrato). Idempotente. */
  seedPilotoViolacoes(): Promise<{ linhas: string[] }>;
  /** Liga/desliga uma flag SÓ no backend de e2e (as rotas e o Studio leem o mesmo getDeps). */
  setFlag(nome: string, ligada: boolean): void;
  /** Liga/desliga um Blob EM MEMÓRIA (MOCK) só no backend de e2e. Desligado (padrão) = sem armazenamento: as rotas de arquivo respondem 503, como sem S3. */
  setBlobMemoria(ligado: boolean): void;
}

export type FabricaE2eBackend = () => Promise<E2eBackend>;
