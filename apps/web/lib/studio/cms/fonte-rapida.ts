// Fonte rápida e evidência rápida na Nova matéria (auditoria P2-05). Contrato: fast-track/contratos/fonte-rapida-evidencia-api.md (Backend 3).
// A fonte nasce "a confirmar" e INATIVA (não coleta nada); a evidência guarda só o trecho e NÃO conta para os gates de publicação.
// Aqui ficam os tipos e a validação prévia, em português, para a pessoa não esperar a ida ao servidor para saber o que falta; o Backend revalida tudo.

export const TIPOS_FONTE: readonly { valor: string; rotulo: string }[] = [
  { valor: 'site', rotulo: 'Site' },
  { valor: 'rss', rotulo: 'RSS' },
  { valor: 'api', rotulo: 'API' },
  { valor: 'comunicado', rotulo: 'Comunicado' },
];
export const LICENCAS: readonly { valor: string; rotulo: string }[] = [
  { valor: 'desconhecida', rotulo: 'Não sei (a revisão confere)' },
  { valor: 'aberta', rotulo: 'Aberta' },
  { valor: 'creative_commons', rotulo: 'Creative Commons' },
  { valor: 'termos_do_site', rotulo: 'Termos do site' },
  { valor: 'direitos_reservados', rotulo: 'Direitos reservados' },
];
export const TRECHO_MAX = 500;

export interface FonteRapida {
  id: string;
  nome: string;
  url: string;
  tipo: string;
  licenca: string;
  revisao: 'a_confirmar' | 'confirmada';
  ativo: boolean;
  termosRevisados: boolean;
  acesso: string;
}
export interface EvidenciaRapida {
  id: string;
  articleId: string;
  sourceId: string | null;
  url: string;
  trecho: string;
  estado: 'a_confirmar' | 'confirmada';
  criadoPor: string;
  criadoEm: string;
}

/** Chave de idempotência (8–100: letras, números, `:` `_` `.` `-`). Gerada uma vez por formulário exibido: reenviar o mesmo formulário não duplica. */
export const novaChave = (prefixo: 'fr' | 'ev', uuid: string): string => `${prefixo}-${uuid}`;

const URL_HTTPS = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && v.length <= 2000;
  } catch {
    return false;
  }
};

export type Validacao<T> = { ok: true; corpo: T } | { ok: false; erro: string };

export interface EntradaFonte {
  chave: string;
  url: string;
  nome: string;
  tipo: string;
  licenca: string;
  editoria: string;
}
export function montarFonteRapida(e: EntradaFonte): Validacao<EntradaFonte> {
  const url = e.url.trim();
  const nome = e.nome.trim();
  if (!URL_HTTPS(url)) return { ok: false, erro: 'URL da fonte: informe um endereço https:// válido, sem usuário e senha.' };
  if (nome.length < 1 || nome.length > 120) return { ok: false, erro: 'Nome da fonte: de 1 a 120 caracteres.' };
  if (!TIPOS_FONTE.some((t) => t.valor === e.tipo)) return { ok: false, erro: 'Tipo da fonte: escolha uma das opções.' };
  if (!LICENCAS.some((l) => l.valor === e.licenca)) return { ok: false, erro: 'Licença: escolha uma das opções.' };
  if (!e.editoria) return { ok: false, erro: 'Editoria: escolha a editoria da fonte.' };
  return { ok: true, corpo: { chave: e.chave, url, nome, tipo: e.tipo, licenca: e.licenca, editoria: e.editoria } };
}

export interface EntradaEvidencia {
  chave: string;
  articleId: string;
  url: string;
  trecho: string;
  sourceId?: string;
}
export function montarEvidencia(e: EntradaEvidencia): Validacao<EntradaEvidencia> {
  const url = e.url.trim();
  const trecho = e.trecho.trim();
  if (!e.articleId) return { ok: false, erro: 'Salve o rascunho antes de anexar evidência.' };
  if (!URL_HTTPS(url)) return { ok: false, erro: 'URL da evidência: informe um endereço https:// válido, sem usuário e senha.' };
  if (trecho.length < 1) return { ok: false, erro: 'Trecho: cole o trecho que sustenta a informação.' };
  if (trecho.length > TRECHO_MAX) return { ok: false, erro: `Trecho: no máximo ${TRECHO_MAX} caracteres (há ${trecho.length}).` };
  return { ok: true, corpo: { chave: e.chave, articleId: e.articleId, url, trecho, ...(e.sourceId ? { sourceId: e.sourceId } : {}) } };
}

/**
 * Para onde levar a pessoa quando a matéria não passa para a checagem por falta de fonte: a página da fonte da PRIMEIRA evidência rápida que
 * tem fonte (é ali que se revisam os termos e se ativa); sem evidência com fonte, a lista do Banco de fontes. O id vira só um segmento de caminho.
 */
export function proximaFonteDaEvidencia(evidencias: readonly { sourceId: string | null }[]): string {
  const id = evidencias.find((e) => e.sourceId && /^[A-Za-z0-9_-]{1,128}$/.test(e.sourceId))?.sourceId;
  return id ? `/studio/fontes/${id}` : '/studio/fontes';
}

/** Mensagens para os códigos que o contrato define (o resto passa pelo tradutor de erros comum). */
export function mensagemDoCodigo(codigo: string | undefined, _detalhes: unknown, padrao: string, nomeDaFonte?: string): string {
  switch (codigo) {
    case 'SOURCE_EXISTS':
      // nome da fonte já cadastrada (nunca o código interno); a tela a deixa escolhida no formulário de evidência
      return nomeDaFonte ? `Esta URL já está cadastrada como a fonte “${nomeDaFonte}”: use essa fonte em vez de criar outra.` : 'Esta URL já está cadastrada: use essa fonte em vez de criar outra.';
    case 'ARTICLE_NOT_DRAFT':
      return 'Só se anexa evidência a matéria em rascunho. Volte a matéria a rascunho para continuar.';
    case 'SOURCE_NOT_FOUND':
      return 'A fonte escolhida não existe mais. Escolha outra ou anexe sem fonte.';
    case 'IDEMPOTENCY_MISMATCH':
      return 'Este formulário já foi enviado com outros dados. Recarregue a página e envie de novo.';
    case 'NOT_FOUND':
      return 'Matéria não encontrada.';
    default:
      return padrao;
  }
}
