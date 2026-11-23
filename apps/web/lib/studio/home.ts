// Gestão da home e dos menus (R3-08, Blueprint §1 "Home: ordem dos componentes"). Versões imutáveis: salvar ou voltar
// atrás cria nova versão (rollback nunca sobrescreve). Posições de anúncio têm dimensão reservada: espaço vazio não desloca o layout.
import { EDITORIAS, isEnabled, type FlagName } from '@ln/contracts';
import { falha, relogioSistema, singleton, type Auditoria, type Relogio, type Resultado } from './registros';

export interface Bloco {
  id: string;
  nome: string;
  /** Posição fixa: não se move (ticker, header, footer). */
  fixo: boolean;
  /** Sempre visível (header, footer). */
  obrigatorio?: boolean;
  visivel: boolean;
  /** Dimensão reservada desktop (posições de anúncio). */
  dimensao?: string;
}

/** Ordem 0–12 do Blueprint. Dimensões: topo 1280×150 e rodapé 1280×200 (wireframe do Design System). */
export const BLOCOS_PADRAO: readonly Bloco[] = [
  { id: 'ticker', nome: 'Ticker de indicadores', fixo: true, visivel: false },
  { id: 'header', nome: 'Logo, header e menu', fixo: true, obrigatorio: true, visivel: true },
  { id: 'banner-topo', nome: 'Banner topo', fixo: false, visivel: true, dimensao: '1280×150' },
  { id: 'destaques', nome: 'Destaques', fixo: false, visivel: true },
  { id: 'em-alta', nome: 'Em alta', fixo: false, visivel: true },
  { id: 'mercado', nome: 'Mercado', fixo: false, visivel: true },
  { id: 'agenda', nome: 'Agenda', fixo: false, visivel: true },
  { id: 'ultimas', nome: 'Últimas', fixo: false, visivel: true },
  { id: 'the-loyal', nome: 'The Loyal (CTA)', fixo: false, visivel: false },
  { id: 'editorias', nome: 'Editorias', fixo: false, visivel: true },
  { id: 'banner-rodape', nome: 'Banner rodapé', fixo: false, visivel: true, dimensao: '1280×200' },
  { id: 'captura', nome: 'Captura pré-footer', fixo: false, visivel: false },
  { id: 'footer', nome: 'Footer', fixo: true, obrigatorio: true, visivel: true },
];

export interface ItemMenu {
  id: string;
  nome: string;
  visivel: boolean;
  /** Flag que precisa estar ligada para o item aparecer. */
  flag?: FlagName;
}

export const MENU_PADRAO: readonly ItemMenu[] = [
  { id: 'noticias', nome: 'Notícias', visivel: true },
  { id: 'market-data', nome: 'Market Data', visivel: false, flag: 'portalMarketData' },
  { id: 'podcast', nome: 'Podcast', visivel: false, flag: 'portalPodcast' },
  { id: 'agenda', nome: 'Agenda', visivel: true },
  { id: 'tecnologia', nome: 'Tecnologia', visivel: true },
  { id: 'entrevistas', nome: 'Entrevistas', visivel: true },
  { id: 'contato', nome: 'Contato', visivel: true },
];

export interface HomeConfig {
  blocos: Bloco[];
  menu: ItemMenu[];
}

export interface VersaoHome {
  numero: number;
  autor: string;
  em: string;
  nota: string;
  config: HomeConfig;
}

export const configPadrao = (): HomeConfig => ({ blocos: BLOCOS_PADRAO.map((b) => ({ ...b })), menu: MENU_PADRAO.map((m) => ({ ...m })) });

export function validarHome(c: HomeConfig, flags: Partial<Record<FlagName, boolean>> = {}): string[] {
  const e: string[] = [];
  const ids = c.blocos.map((b) => b.id);
  if (new Set(ids).size !== ids.length) e.push('Blocos duplicados.');
  if (BLOCOS_PADRAO.some((p) => !ids.includes(p.id)) || ids.length !== BLOCOS_PADRAO.length) e.push('A home precisa conter exatamente os blocos do blueprint.');
  BLOCOS_PADRAO.forEach((p, i) => {
    if (p.fixo && ids.indexOf(p.id) !== i) e.push(`O bloco "${p.nome}" tem posição fixa (${i}).`);
  });
  for (const b of c.blocos) {
    const base = BLOCOS_PADRAO.find((p) => p.id === b.id);
    if (base?.obrigatorio && !b.visivel) e.push(`O bloco "${base.nome}" não pode ser escondido.`);
    if (base?.dimensao && b.dimensao !== base.dimensao) e.push(`A dimensão reservada de "${base.nome}" (${base.dimensao}) não pode mudar.`);
  }
  const mids = c.menu.map((m) => m.id);
  if (new Set(mids).size !== mids.length || MENU_PADRAO.some((m) => !mids.includes(m.id)) || mids.length !== MENU_PADRAO.length) e.push('Menu inconsistente.');
  for (const m of c.menu) {
    const ligada = m.flag ? (flags[m.flag] ?? isEnabled(m.flag)) : true;
    if (m.visivel && !ligada) e.push(`"${m.nome}" depende da flag ${m.flag}, desligada: não pode ficar visível.`);
  }
  return e;
}

export class HomeService {
  readonly versoes: VersaoHome[] = [];
  readonly trilha: Auditoria[] = [];
  constructor(private readonly relogio: Relogio = relogioSistema) {
    this.versoes.push({ numero: 1, autor: 'sistema', em: this.relogio.agora(), nota: 'Configuração inicial (ordem do blueprint)', config: configPadrao() });
  }

  /** Rascunho em edição (ainda não é versão). Some ao reiniciar. */
  rascunho: HomeConfig | null = null;

  editarRascunho(fn: (c: HomeConfig) => HomeConfig): HomeConfig {
    this.rascunho = fn(structuredClone(this.rascunho ?? this.vigente().config));
    return structuredClone(this.rascunho);
  }

  descartarRascunho() {
    this.rascunho = null;
  }

  /** Salva o rascunho como nova versão (valida); sucesso limpa o rascunho. */
  salvarRascunho(quem: string, nota: string, flags: Partial<Record<FlagName, boolean>> = {}): Resultado<VersaoHome> {
    if (!this.rascunho) return falha('Não há alterações para salvar.');
    const r = this.salvar(quem, this.rascunho, nota, flags);
    if (r.ok) this.rascunho = null;
    return r;
  }

  vigente(): VersaoHome {
    return structuredClone(this.versoes[this.versoes.length - 1]!);
  }

  salvar(quem: string, config: HomeConfig, nota: string, flags: Partial<Record<FlagName, boolean>> = {}): Resultado<VersaoHome> {
    const erros = validarHome(config, flags);
    if (erros.length) return falha(...erros);
    const v: VersaoHome = { numero: this.versoes.length + 1, autor: quem, em: this.relogio.agora(), nota: nota.trim() || 'sem nota', config: structuredClone(config) };
    this.versoes.push(v);
    this.trilha.push({ em: v.em, quem, acao: 'home_versao_salva', alvo: `v${v.numero}`, detalhe: v.nota });
    return { ok: true, valor: structuredClone(v) };
  }

  /** Rollback = nova versão com o conteúdo de uma anterior. */
  reverter(quem: string, numero: number): Resultado<VersaoHome> {
    const alvo = this.versoes.find((v) => v.numero === numero);
    if (!alvo) return falha('Versão não encontrada.');
    const r = this.salvar(quem, alvo.config, `rollback para v${numero}`);
    if (r.ok) this.trilha.push({ em: r.valor.em, quem, acao: 'home_rollback', alvo: `v${numero}`, detalhe: `nova v${r.valor.numero}` });
    return r;
  }
}

export function moverBloco(c: HomeConfig, id: string, direcao: -1 | 1): HomeConfig {
  const blocos = [...c.blocos];
  const i = blocos.findIndex((b) => b.id === id);
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= blocos.length || blocos[i]!.fixo || blocos[j]!.fixo) return c;
  [blocos[i], blocos[j]] = [blocos[j]!, blocos[i]!];
  return { ...c, blocos };
}

export const alternarBloco = (c: HomeConfig, id: string): HomeConfig => ({ ...c, blocos: c.blocos.map((b) => (b.id === id && !b.obrigatorio ? { ...b, visivel: !b.visivel } : b)) });

export function moverMenu(c: HomeConfig, id: string, direcao: -1 | 1): HomeConfig {
  const menu = [...c.menu];
  const i = menu.findIndex((m) => m.id === id);
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= menu.length) return c;
  [menu[i], menu[j]] = [menu[j]!, menu[i]!];
  return { ...c, menu };
}

export const alternarMenu = (c: HomeConfig, id: string): HomeConfig => ({ ...c, menu: c.menu.map((m) => (m.id === id ? { ...m, visivel: !m.visivel } : m)) });

export const EDITORIAS_MENU = EDITORIAS;

export const getHome = () => singleton('home', () => new HomeService());
