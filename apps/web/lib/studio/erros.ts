// Mensagens de erro do Backend para a pessoa da redação (auditoria de UX, P1-02): o validador (zod) devolve `caminho: mensagem` em inglês e com nomes
// internos. Aqui o caminho vira o nome do campo como aparece na tela e a mensagem vira português. O que não se conhece passa como veio (nunca se perde
// informação), e a mensagem de negócio do Backend (já em português) não é mexida.

/** Campo interno → como a tela o chama. */
const CAMPOS: Record<string, string> = {
  slug: 'Slug',
  titulo: 'Título',
  subtitulo: 'Subtítulo',
  resumo: 'Resumo',
  corpo: 'Corpo',
  editoria: 'Editoria',
  fonteUrl: 'URL da fonte oficial',
  url: 'URL',
  nome: 'Nome',
  local: 'Local',
  inicio: 'Início',
  fim: 'Fim',
  tituloPadrao: 'Título padrão',
  descricaoPadrao: 'Descrição padrão',
  imagemOgUrl: 'Imagem de compartilhamento',
  indexacao: 'Indexação',
  'dadosEstruturados.organizacao.nome': 'Organização: nome',
  'dadosEstruturados.organizacao.url': 'Organização: URL do site',
  'dadosEstruturados.organizacao.logoUrl': 'Organização: URL do logo',
  'dadosEstruturados.organizacao.sameAs': 'Organização: perfis oficiais',
  'direitos.url': 'URL do ativo',
  'direitos.credito': 'Crédito',
  'direitos.origem': 'Origem',
  'direitos.baseDeDireito': 'Base de direito',
  'direitos.textoAlternativo': 'Texto alternativo',
  'direitos.link': 'Link da fonte',
  termo: 'Termo',
  destino: 'Destino',
  origem: 'Origem',
  rotulo: 'Rótulo',
  titulo_bloco: 'Título do bloco',
  materiaSlugs: 'Matérias do destaque',
  limite: 'Limite de itens',
  posicao: 'Posição',
  officialUrl: 'Página oficial',
  motivo: 'Motivo',
  casoCorrecaoId: 'Caso de correção',
  versaoEsperada: 'Versão',
  // comercial (chaves da API em inglês)
  name: 'Nome',
  accountId: 'Anunciante',
  formatId: 'Formato',
  positionId: 'Posição',
  positionIds: 'Posições da campanha',
  startDate: 'Início',
  endDate: 'Fim',
  altText: 'Texto alternativo',
  destinationUrl: 'Destino',
  advertiserName: 'Anunciante exibido',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  role: 'Cargo',
  basis: 'Base legal',
  campaignId: 'Campanha',
  creativeId: 'Criativo',
  reservationId: 'Reserva',
  reservationIds: 'Reservas',
  from: 'De',
  to: 'Até',
  // Creative studio
  articleId: 'Matéria',
  kind: 'Template',
  format: 'Formato',
  autoralFormato: 'Formato autoral',
  para: 'Novo estado',
  // Studio 2: watchlists, pedidos do titular, leitura e violações do piloto (P1-02 nas telas da frente)
  watchlistId: 'Watchlist',
  entityType: 'Tipo de entidade',
  entityId: 'Entidade',
  responsavel: 'Responsável',
  acao: 'Ação',
  campos: 'Campos corrigidos',
  acaoTomada: 'Ação tomada',
  leitor: 'Leitor',
  trecho: 'Trecho',
  tipo: 'Tipo do fato',
  gravidade: 'Gravidade',
  evidenciaId: 'Evidência',
  nota: 'Nota',
  checklist: 'Conferência',
  'checklist.fatosNasEvidencias': 'Conferência: fatos nas evidências',
  'checklist.tom': 'Conferência: tom',
  'checklist.nadaInventado': 'Conferência: nada inventado',
  veredito: 'Veredito',
  leitor2Nome: 'Quem leu',
  'arquivo.nome': 'Arquivo: nome',
  'arquivo.sha256': 'Arquivo: hash',
  'arquivo.linhas': 'Arquivo: linhas',
  materia: 'Matéria',
  materias: 'Matérias',
};

const rotuloDoCampo = (caminho: string): string => {
  if (CAMPOS[caminho]) return CAMPOS[caminho]!;
  // blocos[2].limite → "Bloco 3: Limite de itens"; itens[0].rotulo → "Item 1: Rótulo"; regras[1].termo → "Regra 2: Termo"
  const m = /^(blocos|itens|regras|ancoras|claims|achados|leituras)\[(\d+)\]\.?(.*)$/.exec(caminho);
  if (m) {
    const nome = { blocos: 'Bloco', itens: 'Item', regras: 'Regra', ancoras: 'Âncora', claims: 'Afirmação', achados: 'Achado', leituras: 'Leitura' }[m[1] as 'blocos'];
    // recursivo: leituras[0].achados[1].trecho → "Leitura 1: Achado 2: Trecho"
    const resto = m[3] ? rotuloDoCampo(m[3]) : '';
    return `${nome} ${Number(m[2]) + 1}${resto ? `: ${resto}` : ''}`;
  }
  const ultimo = caminho.split('.').pop() ?? caminho;
  return CAMPOS[ultimo] ?? caminho;
};

/** Mensagem do validador em português; o que não reconhece passa como veio. */
export function traduzirMensagem(m: string): string {
  const t = m.trim();
  let r: RegExpExecArray | null;
  if (/^Invalid URL$/i.test(t) || /^Invalid url$/i.test(t)) return 'URL inválida (use https://…).';
  if ((r = /^Too small: expected string to have >=?\s*(\d+) characters?$/i.exec(t))) return r[1] === '1' ? 'obrigatório.' : `precisa ter pelo menos ${r[1]} caracteres.`;
  if ((r = /^Too big: expected string to have <=?\s*(\d+) characters?$/i.exec(t))) return `pode ter no máximo ${r[1]} caracteres.`;
  if ((r = /^Too small: expected (?:array|number) to have >=?\s*(\d+)/i.exec(t))) return `precisa de pelo menos ${r[1]}.`;
  if ((r = /^Too big: expected (?:array|number) to have <=?\s*(\d+)/i.exec(t))) return `no máximo ${r[1]}.`;
  if (/^Invalid input: expected string, received undefined$/i.test(t) || /^Required$/i.test(t) || /received undefined/i.test(t)) return 'obrigatório.';
  if (/^Invalid input: expected (\w+), received (\w+)$/i.test(t)) return 'valor com formato inválido.';
  if (/^Invalid option/i.test(t) || /^Invalid enum value/i.test(t)) return 'opção inválida.';
  if (/^Invalid string: must match pattern/i.test(t) || /^Invalid string/i.test(t)) return 'formato inválido.';
  if (/^Invalid input$/i.test(t)) return 'valor inválido.';
  if (/^Unrecognized key/i.test(t)) return 'campo não reconhecido.';
  return t;
}

/** `caminho: mensagem` do validador → `Campo: mensagem` em português. */
export function traduzirDetalhe(d: { path?: string; message?: string }): string {
  const msg = traduzirMensagem(d.message ?? '');
  if (!d.path) return msg;
  return `${rotuloDoCampo(d.path)}: ${msg}`;
}
