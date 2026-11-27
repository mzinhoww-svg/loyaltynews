// Medição do portal (contrato de eventos do @ln/analytics) atrás da flag `analytics` do contrato (ADR-022), desligada por padrão.
// Lida a cada chamada, em execução, pelo resolvedor do servidor. A flag não tem entrada em FLAG_RELEASES: nenhum ambiente a liga por
// variável; ligar é mudança de código com decisão registrada. Só servidor: o navegador recebe apenas o booleano.
import { runtimeFlags } from './runtime-flags';

export function medicaoAtiva(): boolean {
  return runtimeFlags().analytics === true;
}
