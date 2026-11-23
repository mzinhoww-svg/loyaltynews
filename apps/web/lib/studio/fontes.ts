// Banco de fontes (Blueprint §5, D10): só acesso público, sem contornar login/paywall.
// Fonte só fica ativa com termos revisados; URL única; ao menos uma editoria.
import { EDITORIAS, Source } from '@ln/contracts';
import { falha, normalizarUrl, relogioSistema, singleton, urlValida, type Auditoria, type Relogio, type Resultado } from './registros';

export interface FonteRegistro {
  id: string;
  nome: string;
  url: string;
  tipo: 'site' | 'rss' | 'api' | 'comunicado';
  editorias: string[];
  termosRevisados: boolean;
  ativo: boolean;
  criadaEm: string;
  atualizadaEm: string;
}

export interface FonteInput {
  nome: string;
  url: string;
  tipo: string;
  editorias: string[];
  termosRevisados: boolean;
  ativo: boolean;
}

const SLUGS = EDITORIAS.map((e) => e.slug) as readonly string[];

export function validarFonte(i: FonteInput): string[] {
  const e: string[] = [];
  if (!i.nome.trim()) e.push('Nome obrigatório.');
  if (!urlValida(i.url)) e.push('URL inválida (use http ou https).');
  if (!['site', 'rss', 'api', 'comunicado'].includes(i.tipo)) e.push('Tipo de fonte inválido.');
  if (i.editorias.length === 0) e.push('Escolha ao menos uma editoria.');
  if (i.editorias.some((s) => !SLUGS.includes(s))) e.push('Editoria desconhecida.');
  if (i.ativo && !i.termosRevisados) e.push('Fonte só pode ficar ativa depois de revisar os termos de uso (D10).');
  return e;
}

export class FontesService {
  private readonly itens = new Map<string, FonteRegistro>();
  readonly trilha: Auditoria[] = [];
  constructor(private readonly relogio: Relogio = relogioSistema) {}

  list(): FonteRegistro[] {
    return [...this.itens.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((f) => structuredClone(f));
  }
  get(id: string) {
    const f = this.itens.get(id);
    return f ? structuredClone(f) : undefined;
  }

  private validar(i: FonteInput, idAtual?: string): string[] {
    const erros = validarFonte(i);
    if (erros.length === 0) {
      const chave = normalizarUrl(i.url);
      if ([...this.itens.values()].some((f) => f.id !== idAtual && normalizarUrl(f.url) === chave)) erros.push('Já existe uma fonte com esta URL.');
      // O contrato é a última palavra: nada fora do schema entra.
      const p = Source.safeParse({ id: idAtual ?? 'novo', nome: i.nome.trim(), url: i.url, tipo: i.tipo, editorias: i.editorias, acesso: 'publico', termosRevisados: i.termosRevisados, ativo: i.ativo });
      if (!p.success) erros.push(...p.error.issues.map((x) => `Contrato: ${x.message}`));
    }
    return erros;
  }

  criar(quem: string, i: FonteInput): Resultado<FonteRegistro> {
    const erros = this.validar(i);
    if (erros.length) return falha(...erros);
    const agora = this.relogio.agora();
    const f: FonteRegistro = { id: this.relogio.id(), nome: i.nome.trim(), url: i.url, tipo: i.tipo as FonteRegistro['tipo'], editorias: i.editorias, termosRevisados: i.termosRevisados, ativo: i.ativo, criadaEm: agora, atualizadaEm: agora };
    this.itens.set(f.id, f);
    this.trilha.push({ em: agora, quem, acao: 'fonte_criada', alvo: f.id, detalhe: f.nome });
    return { ok: true, valor: structuredClone(f) };
  }

  atualizar(quem: string, id: string, i: FonteInput): Resultado<FonteRegistro> {
    const atual = this.itens.get(id);
    if (!atual) return falha('Fonte não encontrada.');
    const erros = this.validar(i, id);
    if (erros.length) return falha(...erros);
    const agora = this.relogio.agora();
    Object.assign(atual, { nome: i.nome.trim(), url: i.url, tipo: i.tipo, editorias: i.editorias, termosRevisados: i.termosRevisados, ativo: i.ativo, atualizadaEm: agora });
    this.trilha.push({ em: agora, quem, acao: 'fonte_atualizada', alvo: id });
    return { ok: true, valor: structuredClone(atual) };
  }

  alternarAtivo(quem: string, id: string): Resultado<FonteRegistro> {
    const atual = this.itens.get(id);
    if (!atual) return falha('Fonte não encontrada.');
    return this.atualizar(quem, id, { ...atual, ativo: !atual.ativo });
  }
}

export const getFontes = () => singleton('fontes', () => new FontesService());
