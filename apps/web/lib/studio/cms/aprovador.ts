// Quem aprovou a versão, como a pessoa lê na tela (P2-02 da auditoria): "você" para a própria sessão, o NOME de quem aprovou quando o Backend o
// devolve (GET /api/materias/:id, recibo.aprovadorNome; nunca o e-mail) e, sem nome (usuário removido ou Backend antigo), o identificador curto.
export function rotuloAprovador(aprovadorId: string, aprovadorNome: string | null | undefined, sessaoUserId: string): string {
  if (aprovadorId === sessaoUserId) return 'você';
  const nome = typeof aprovadorNome === 'string' ? aprovadorNome.trim() : '';
  return nome || `outro usuário (${aprovadorId.slice(0, 8)}…)`;
}
