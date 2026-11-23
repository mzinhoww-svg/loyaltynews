export interface E2eBackend {
  /** Usuário do papel com sessão real (cookies Set-Cookie do Better Auth). `mfa=false`: só senha, sem 2º fator. */
  login(user: string, role: string, mfa: boolean): Promise<{ id: string; setCookies: string[] }>;
  /** Semeia UMA matéria da Fábrica editorial (rascunho com 1 afirmação e 1 evidência, sem veredito) no banco de e2e. Idempotente. */
  seedEditorial(): Promise<{ articleId: string }>;
}

export type FabricaE2eBackend = () => Promise<E2eBackend>;
