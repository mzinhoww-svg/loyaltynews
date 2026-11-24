// Login do Studio (/studio/entrar): regras puras da tela (sem rede e sem DOM), para testar à parte.
// Nada aqui guarda nem registra e-mail, senha ou código: a tela só repassa ao /api/auth (Better Auth + 2º fator, ADR-011).

export const DESTINO_PADRAO = '/studio';

/**
 * Destino para onde voltar depois do 2º fator. Só caminho do próprio Studio (nunca URL de outro site, `//`, `\` nem `..`),
 * e nunca a própria tela de entrada (evita laço). Qualquer outra coisa vira `/studio`.
 */
export function destinoSeguro(valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 300) return DESTINO_PADRAO;
  if (!/^\/studio(?:\/[A-Za-z0-9\-._~%/]*)?(?:\?[A-Za-z0-9\-._~%=&/]*)?$/.test(valor)) return DESTINO_PADRAO;
  if (valor.includes('//') || valor.includes('..') || valor.includes('\\')) return DESTINO_PADRAO;
  const caminho = valor.split('?')[0]!;
  if (caminho === '/studio/entrar' || caminho.startsWith('/studio/entrar/')) return DESTINO_PADRAO;
  return valor;
}

/** Texto do tempo de espera de um 429 a partir do cabeçalho Retry-After (segundos). */
export function textoEspera(retryAfter: string | null | undefined): string {
  const s = Number.parseInt(retryAfter ?? '', 10);
  if (!Number.isFinite(s) || s <= 0) return 'alguns minutos';
  if (s < 60) return `${s} segundo${s === 1 ? '' : 's'}`;
  const min = Math.ceil(s / 60);
  return `${min} minuto${min === 1 ? '' : 's'}`;
}

export interface RespostaAuth {
  status: number;
  code?: string;
  retryAfter?: string | null;
}

/** Erro do 1º passo (e-mail e senha). GENÉRICO: não diz se o e-mail existe, se a conta está bloqueada ou se a senha é que errou. */
export function erroDeEntrada(r: RespostaAuth): string {
  if (r.status === 429) return `Muitas tentativas. Tente de novo em ${textoEspera(r.retryAfter)}.`;
  if (r.status === 503) return 'O login não está configurado neste ambiente.';
  if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404) return 'E-mail ou senha incorretos.';
  return 'Não foi possível entrar agora. Tente de novo em instantes.';
}

/** Erro do 2º passo (código do aplicativo ou código de recuperação). `reiniciar`: a verificação expirou, volta ao 1º passo. */
export function erroDeCodigo(r: RespostaAuth, recuperacao: boolean): { texto: string; reiniciar: boolean } {
  if (r.status === 429) return { texto: `Muitas tentativas. Tente de novo em ${textoEspera(r.retryAfter)}.`, reiniciar: false };
  if (r.code === 'INVALID_TWO_FACTOR_COOKIE' || r.code === 'TWO_FACTOR_COOKIE_EXPIRED') {
    return { texto: 'A verificação expirou. Entre de novo com e-mail e senha.', reiniciar: true };
  }
  if (r.status === 400 || r.status === 401 || r.status === 403) {
    return { texto: recuperacao ? 'Código de recuperação inválido ou já usado.' : 'Código inválido ou expirado. Confira o aplicativo autenticador e tente de novo.', reiniciar: false };
  }
  if (r.status === 503) return { texto: 'O login não está configurado neste ambiente.', reiniciar: false };
  return { texto: 'Não foi possível verificar o código agora. Tente de novo em instantes.', reiniciar: false };
}

/** Só dígitos, no máximo 6 (o aplicativo autenticador mostra "123 456"; espaços são aceitos na digitação). */
export const limparCodigo = (v: string): string => v.replace(/\D/g, '').slice(0, 6);

/** Código de recuperação: aparado, sem espaços nas pontas. */
export const limparRecuperacao = (v: string): string => v.trim();

/** Caminho + query do pedido do Studio para o cabeçalho interno (sem o parâmetro `_rsc` do Next, que é de transporte). */
export function caminhoDoPedido(pathname: string, search: string): string {
  const p = new URLSearchParams(search);
  p.delete('_rsc');
  const q = p.toString();
  return q ? `${pathname}?${q}` : pathname;
}
