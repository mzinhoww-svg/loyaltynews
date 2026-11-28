// DP-94: o comando avulso `editorial-factory` não roda em produção nem contra o banco de produção. Falha fechada: só com
// APP_ENV=staging E o banco de staging registrado, conferido ANTES de qualquer conexão. Evita engano; quem controla o código e as
// credenciais ainda pode contornar (F-120). A coleta de produção é só a do worker.
import bindingsFile from '../../../infra/vertra/bindings.json';
import type { BindingsFile } from './staging-admin';

export class FactoryRefused extends Error {}

/** Parâmetros que a conexão descarta (TLS vem do ambiente). Qualquer outro pode trocar o destino: o driver os deixa valer sobre o endereço. */
const SSL_PARAM = /^(?:sslmode|ssl|sslcert|sslkey|sslrootcert|sslpassword|uselibpqcompat)$/i;

/**
 * Por que `DATABASE_URL` não serve para o ambiente (null = é o banco registrado dele). Nunca repete o valor. Vale para a Fábrica avulsa
 * (DP-94) e para a retirada (parecer 105).
 */
export function motivoDeOutroDestino(bruto: string | undefined, ambiente: 'staging' | 'production', bindings: BindingsFile = bindingsFile as BindingsFile): string | null {
  const nome = ambiente === 'staging' ? 'staging' : 'produção';
  const reg = bindings.ambientes?.[ambiente];
  if (!reg?.dbHost || !reg.dbName) return `${nome} sem vínculo de banco em infra/vertra/bindings.json`;
  const texto = bruto ?? '';
  let u: URL;
  try {
    u = new URL(texto);
  } catch {
    return 'DATABASE_URL ausente ou inválida';
  }
  if (/\s/.test(texto) || !/^postgres(ql)?:$/.test(u.protocol)) return 'DATABASE_URL precisa ser postgres://, sem espaços';
  if ([...u.searchParams.keys()].some((k) => !SSL_PARAM.test(k))) return 'DATABASE_URL com parâmetro que pode trocar o destino';
  if (u.hostname.toLowerCase() !== reg.dbHost.toLowerCase() || u.pathname !== `/${reg.dbName}`) return `DATABASE_URL não aponta para o banco de ${nome} registrado`;
  return null;
}

/** Lança `FactoryRefused`, sem repetir o valor de variável nenhuma. */
export function assertFactoryEnvironment(env: Record<string, string | undefined>, bindings: BindingsFile = bindingsFile as BindingsFile): void {
  const recusa = (motivo: string) => new FactoryRefused(`recusado: ${motivo}. A Fábrica avulsa só roda em staging, no banco de staging registrado (DP-94)`);
  if (env.APP_ENV !== 'staging') throw recusa('APP_ENV diferente de "staging"');
  const motivo = motivoDeOutroDestino(env.DATABASE_URL, 'staging', bindings);
  if (motivo) throw recusa(motivo);
}
