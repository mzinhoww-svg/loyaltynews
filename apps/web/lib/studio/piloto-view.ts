// Tela de leitura do piloto de 10 matérias (Studio 2; decisão PM-2026-11-23-C): só o leitor 1 (proprietário, admin ou editor-chefe) lê no Studio;
// o QA 3 (leitor 2: a1, a4, a6, a9) lê pela folha e a leitura dele entra depois por importação auditada.
// Contrato combinado com o AgentOps (folha-de-leitura.md; ft/agents 041a74f). Rotas: handlers da Editorial, montadas pelo Backend 1 (ainda não existem).
// A conta do resultado é a MESMA do avaliador do kit (pilot.ts): 0 altas e no máximo 1 média nas 10; baixas só anotadas; sem gravidade = alta.

export type Gravidade = 'alta' | 'media' | 'baixa';
export type TipoAchado = 'numero' | 'data' | 'valor' | 'nome' | 'condicao' | 'causa_efeito' | 'atribuicao' | 'citacao' | 'contexto';
export type MateriaId = 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6' | 'a7' | 'a8' | 'a9' | 'a10';

export const MATERIAS: readonly MateriaId[] = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'];
export const COM_LEITOR_2: readonly MateriaId[] = ['a1', 'a4', 'a6', 'a9'];
export const ehMateria = (v: string): v is MateriaId => (MATERIAS as readonly string[]).includes(v);

export const TIPOS: readonly TipoAchado[] = ['numero', 'data', 'valor', 'citacao', 'atribuicao', 'nome', 'condicao', 'causa_efeito', 'contexto'];
export const ROTULO_TIPO: Record<TipoAchado, string> = {
  numero: 'Número', data: 'Data', valor: 'Valor', citacao: 'Citação', atribuicao: 'Atribuição', nome: 'Nome', condicao: 'Condição', causa_efeito: 'Causa e efeito', contexto: 'Contexto',
};
/** Gravidade sugerida pela folha (o leitor pode mudar): alta = número, data, valor, citação, atribuição; média = nome, condição; baixa = contexto. */
export const GRAVIDADE_DO_TIPO: Record<TipoAchado, Gravidade> = {
  numero: 'alta', data: 'alta', valor: 'alta', citacao: 'alta', atribuicao: 'alta', nome: 'media', condicao: 'media', causa_efeito: 'media', contexto: 'baixa',
};
export const ROTULO_GRAVIDADE: Record<Gravidade, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

export interface Achado {
  trecho: string;
  tipo: TipoAchado;
  gravidade?: Gravidade;
  evidenciaId?: string;
}
export interface Leitura {
  versao: number;
  leitor: 1 | 2;
  /** 'studio' = registrada nesta tela; 'importacao' = folha do leitor 2 importada (auditada). */
  origem?: 'studio' | 'importacao';
  achados: Achado[];
  checklist: { fatosNasEvidencias: boolean; tom: boolean; nadaInventado: boolean };
  veredito: 'aprovado' | 'bloqueado';
  registradoPor: string;
  registradoEm: string;
}
export interface MateriaPiloto {
  materia: MateriaId;
  articleId: string | null;
  fonte: string | null;
  leitor2: boolean;
}

/** Vale a ÚLTIMA versão de cada leitor (correção = nova versão, a anterior fica na trilha). */
export function leituraVigente(leituras: Leitura[], leitor: 1 | 2): Leitura | null {
  return leituras.filter((l) => l.leitor === leitor).sort((a, b) => b.versao - a.versao)[0] ?? null;
}

export interface Contagem {
  unsupported_facts: number;
  altas: number;
  medias: number;
  baixas: number;
}
/** Contagem de uma leitura; achado sem gravidade conta como ALTA (falha fechada, como o avaliador). */
export function contar(l: Leitura): Contagem {
  const c = { unsupported_facts: l.achados.length, altas: 0, medias: 0, baixas: 0 };
  for (const a of l.achados) {
    if (a.gravidade === 'media') c.medias++;
    else if (a.gravidade === 'baixa') c.baixas++;
    else c.altas++;
  }
  return c;
}

export type ResultadoPiloto = { estado: 'inconclusivo'; faltam: MateriaId[]; parcial: Contagem } | { estado: 'aprovado' | 'reprovado'; total: Contagem };
/** Resultado do critério do PM sobre as leituras VIGENTES do leitor 1. Falta qualquer matéria = inconclusivo (nunca "aprovado" com buraco). */
export function resultadoPiloto(porMateria: Partial<Record<MateriaId, Leitura[]>>): ResultadoPiloto {
  const total: Contagem = { unsupported_facts: 0, altas: 0, medias: 0, baixas: 0 };
  const faltam: MateriaId[] = [];
  for (const m of MATERIAS) {
    const l = leituraVigente(porMateria[m] ?? [], 1);
    if (!l) {
      faltam.push(m);
      continue;
    }
    const c = contar(l);
    total.unsupported_facts += c.unsupported_facts;
    total.altas += c.altas;
    total.medias += c.medias;
    total.baixas += c.baixas;
  }
  if (faltam.length) return { estado: 'inconclusivo', faltam, parcial: total };
  return { estado: total.altas === 0 && total.medias <= 1 ? 'aprovado' : 'reprovado', total };
}

/** Linhas de achado do formulário: ignora linhas vazias; trecho obrigatório quando há tipo; tipo e gravidade só dos válidos. */
export function achadosDoFormulario(linhas: { trecho: string; tipo: string; gravidade: string; evidenciaId: string }[]): { ok: true; achados: Achado[] } | { ok: false; erro: string } {
  const achados: Achado[] = [];
  for (const [i, l] of linhas.entries()) {
    const trecho = l.trecho.trim();
    if (!trecho && !l.tipo && !l.evidenciaId.trim()) continue;
    if (!trecho) return { ok: false, erro: `Achado ${i + 1}: cole o trecho do texto que não bate com a evidência.` };
    if (trecho.length > 1000) return { ok: false, erro: `Achado ${i + 1}: trecho com no máximo 1.000 caracteres.` };
    if (!(TIPOS as readonly string[]).includes(l.tipo)) return { ok: false, erro: `Achado ${i + 1}: escolha o tipo do fato.` };
    const tipo = l.tipo as TipoAchado;
    const gravidade = (['alta', 'media', 'baixa'] as const).find((g) => g === l.gravidade) ?? GRAVIDADE_DO_TIPO[tipo];
    achados.push({ trecho, tipo, gravidade, ...(l.evidenciaId.trim() ? { evidenciaId: l.evidenciaId.trim() } : {}) });
  }
  return { ok: true, achados };
}
