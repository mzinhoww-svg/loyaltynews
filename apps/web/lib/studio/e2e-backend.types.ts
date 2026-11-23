export interface E2eBackend {
  /** Usuário do papel com sessão real (cookies Set-Cookie do Better Auth). `mfa=false`: só senha, sem 2º fator. */
  login(user: string, role: string, mfa: boolean): Promise<{ id: string; setCookies: string[] }>;
}

export type FabricaE2eBackend = () => Promise<E2eBackend>;
