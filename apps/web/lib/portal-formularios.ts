// Formulários públicos do portal (contato comercial / pedido de proposta) atrás da flag `portalFormularios` do contrato (ADR-022).
// A flag é lida a CADA chamada, em execução, pelo resolvedor do servidor (runtimeFlags: LN_FLAGS_ON + APP_ENV da subida). Nada é guardado
// em constante de módulo: um valor lido na hora do build ficaria embutido no pacote pré-compilado, e ligar a flag exigiria refazer o build.
// Quem liga a flag em produção é o mecanismo de liberação por commit do contrato (FLAG_RELEASES), não este arquivo.
import { runtimeFlags } from './runtime-flags';

export function formulariosAtivos(): boolean {
  return runtimeFlags().portalFormularios === true;
}
