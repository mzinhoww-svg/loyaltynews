// Tela de leitura do piloto de 10 matérias (Studio 2; decisão PM-2026-11-23-C): no Studio lê só o leitor 1 (proprietário, admin ou editor-chefe).
// Contrato da Editorial: packages/editorial/docs/piloto-leitura-api.md (ft/editorial ccfb23c; handlers em pilot-handlers.ts).
// O FECHAMENTO vem do servidor (mesma conta do avaliador do kit): a tela não recalcula o critério, só mostra.
// Leitura é IMUTÁVEL: uma por leitor e matéria (409 se repetir); o mapa matéria→artigo também (409).

export type Gravidade = 'alta' | 'media' | 'baixa';
export type TipoAchado = 'numero' | 'data' | 'valor' | 'nome' | 'condicao' | 'causa' | 'atribuicao' | 'citacao' | 'contexto';
export type MateriaId = 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6' | 'a7' | 'a8' | 'a9' | 'a10';

export const MATERIAS: readonly MateriaId[] = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'];
export const COM_LEITOR_2: readonly MateriaId[] = ['a1', 'a4', 'a6', 'a9'];
export const ehMateria = (v: string): v is MateriaId => (MATERIAS as readonly string[]).includes(v);

export const TIPOS: readonly TipoAchado[] = ['numero', 'data', 'valor', 'citacao', 'atribuicao', 'nome', 'condicao', 'causa', 'contexto'];
export const ROTULO_TIPO: Record<TipoAchado, string> = {
  numero: 'Número', data: 'Data', valor: 'Valor', citacao: 'Citação', atribuicao: 'Atribuição', nome: 'Nome', condicao: 'Condição', causa: 'Causa e efeito', contexto: 'Contexto',
};
/** Gravidade sugerida pela folha (o leitor pode mudar): alta = número, data, valor, citação, atribuição; média = nome, condição, causa; baixa = contexto. */
export const GRAVIDADE_DO_TIPO: Record<TipoAchado, Gravidade> = {
  numero: 'alta', data: 'alta', valor: 'alta', citacao: 'alta', atribuicao: 'alta', nome: 'media', condicao: 'media', causa: 'media', contexto: 'baixa',
};
export const ROTULO_GRAVIDADE: Record<Gravidade, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

export interface Achado {
  trecho: string;
  tipo: TipoAchado;
  gravidade: Gravidade;
  evidenciaId?: string;
  nota?: string;
}
export interface Checklist {
  fatosNasEvidencias: boolean;
  tom: boolean;
  nadaInventado: boolean;
}
export type EstadoMateria = 'nao_gerada' | 'aguardando_leitura' | 'leitor1_registrou' | 'leitor2_registrou' | 'lida';
export interface MateriaPiloto {
  materia: MateriaId;
  articleId: string | null;
  fonte: { id: string; nome: string } | null;
  leitor2: boolean;
  estado: EstadoMateria;
  leituras: { leitor1: boolean; leitor2: boolean };
  /** Hash e data da PRIMEIRA folha do leitor 2 registrada para a matéria (nunca o conteúdo). */
  folha?: { sha256: string; em: string } | null;
}
export interface Fechamento {
  lidas: number;
  altas: number;
  medias: number;
  baixas: number;
  unsupportedFacts: number;
  criterio: 'em_andamento' | 'aprovado' | 'reprovado';
  divergencias: string[];
}
export interface Leitura {
  materia: string;
  articleId: string;
  leitor: 1 | 2;
  por: string;
  em: string;
  /** Leitura do leitor 2 importada da folha: 'importacao', com o arquivo (nome, sha256, linhas). */
  origem?: 'studio' | 'importacao';
  arquivo?: { nome: string; sha256: string; linhas: number };
  achados: Achado[];
  checklist: Checklist;
  veredito: 'aprovado' | 'bloqueado';
  unsupportedFacts: number;
  altas: number;
  medias: number;
  baixas: number;
}

export const ROTULO_ESTADO: Record<EstadoMateria, string> = {
  nao_gerada: 'ainda não gerada',
  aguardando_leitura: 'aguardando sua leitura',
  leitor1_registrou: 'lida por você',
  leitor2_registrou: 'lida pelo QA 3; falta a sua',
  lida: 'lida pelos leitores previstos',
};
export const ROTULO_CRITERIO: Record<Fechamento['criterio'], string> = { em_andamento: 'em andamento', aprovado: 'aprovado', reprovado: 'reprovado' };

/** Linhas de achado do formulário, já nas regras do servidor: vazias ignoradas; trecho 3 a 500; tipo válido; gravidade padrão do tipo. */
export function achadosDoFormulario(linhas: { trecho: string; tipo: string; gravidade: string; evidenciaId: string }[]): { ok: true; achados: Achado[] } | { ok: false; erro: string } {
  const achados: Achado[] = [];
  for (const [i, l] of linhas.entries()) {
    const trecho = l.trecho.trim();
    if (!trecho && !l.tipo && !l.evidenciaId.trim()) continue;
    if (trecho.length < 3) return { ok: false, erro: `Achado ${i + 1}: cole o trecho do texto que não bate com a evidência (mínimo de 3 caracteres).` };
    if (trecho.length > 500) return { ok: false, erro: `Achado ${i + 1}: trecho com no máximo 500 caracteres.` };
    if (!(TIPOS as readonly string[]).includes(l.tipo)) return { ok: false, erro: `Achado ${i + 1}: escolha o tipo do fato.` };
    const tipo = l.tipo as TipoAchado;
    const gravidade = (['alta', 'media', 'baixa'] as const).find((g) => g === l.gravidade) ?? GRAVIDADE_DO_TIPO[tipo];
    achados.push({ trecho, tipo, gravidade, ...(l.evidenciaId.trim() ? { evidenciaId: l.evidenciaId.trim() } : {}) });
  }
  return { ok: true, achados };
}

/** A mesma regra do servidor para "aprovada": sem achado de gravidade alta e com os três itens do checklist marcados. Devolve o motivo ou null. */
export function erroDoVeredito(veredito: string, achados: Achado[], checklist: Checklist): string | null {
  if (veredito !== 'aprovado' && veredito !== 'bloqueado') return 'Marque o veredito: aprovada ou bloqueada.';
  if (veredito === 'aprovado' && achados.some((a) => a.gravidade === 'alta')) return 'Com fato de gravidade alta a matéria não pode ser aprovada: marque bloqueada.';
  if (veredito === 'aprovado' && !(checklist.fatosNasEvidencias && checklist.tom && checklist.nadaInventado)) return 'Para aprovar, confira e marque os três itens.';
  return null;
}

/** Mapa matéria→artigo do formulário: só matérias válidas e ids preenchidos (1 a 128). */
export function mapaDoFormulario(campos: Partial<Record<MateriaId, string>>): { ok: true; mapa: Partial<Record<MateriaId, string>> } | { ok: false; erro: string } {
  const mapa: Partial<Record<MateriaId, string>> = {};
  for (const m of MATERIAS) {
    const v = (campos[m] ?? '').trim();
    if (!v) continue;
    if (v.length > 128) return { ok: false, erro: `${m}: id do artigo com no máximo 128 caracteres.` };
    mapa[m] = v;
  }
  if (!Object.keys(mapa).length) return { ok: false, erro: 'Informe o artigo de pelo menos uma matéria.' };
  return { ok: true, mapa };
}
