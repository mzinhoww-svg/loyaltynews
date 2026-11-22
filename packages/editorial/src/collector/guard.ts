/** ADR-007: nenhum perfil de modelo pode ter ferramenta de rede. Útil ao validador de packages/agents. */
const NETWORK_TOOL = /(^|[_.\-:/])(fetch|browse|browser|http|https|curl|wget|web[_-]?search|web[_-]?fetch|navigate|request|download|socket)([_.\-:/]|$)/i;

export function networkTools(allowedTools: readonly string[]): string[] {
  return allowedTools.filter((t) => NETWORK_TOOL.test(t));
}
export function assertNoNetworkTools(profileId: string, allowedTools: readonly string[]): void {
  const bad = networkTools(allowedTools);
  if (bad.length) throw new Error(`perfil ${profileId} tem ferramenta de rede: ${bad.join(', ')}`);
}
