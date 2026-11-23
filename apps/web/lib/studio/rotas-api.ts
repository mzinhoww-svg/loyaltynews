// Rotas reais do Backend usadas pelo Studio (chamadas em processo, com a sessão do usuário). Cada função repassa o cookie
// e devolve { status, body }; quem chama decide como mostrar erro, 503 "banco não configurado" e estados vazios.
import * as materiasRoute from '@/app/api/materias/route';
import * as materiaRoute from '@/app/api/materias/[id]/route';
import * as materiaFontesRoute from '@/app/api/materias/[id]/fontes/route';
import * as materiaReciboRoute from '@/app/api/materias/[id]/recibos/route';
import * as materiaTransicaoRoute from '@/app/api/materias/[id]/transicao/route';
import type { RascunhoFabrica } from '@/lib/studio/cms/fabrica-correcao';
import type { PautaVista } from '@/lib/studio/cms/pauta';
import * as materiaCorrecaoRoute from '@/app/api/materias/[id]/correcao/route';
import * as fontesRoute from '@/app/api/fontes/route';
import * as fonteRoute from '@/app/api/fontes/[id]/route';
import * as evidenciasRoute from '@/app/api/fontes/[id]/evidencias/route';
import * as midiasRoute from '@/app/api/midia/route';
import * as midiaRoute from '@/app/api/midia/[id]/route';
import * as agendasRoute from '@/app/api/agenda/route';
import * as agendaRoute from '@/app/api/agenda/[id]/route';
import * as agendaModeracaoRoute from '@/app/api/agenda/[id]/moderacao/route';
import * as midiaUploadRoute from '@/app/api/midia/arquivo/route';
import * as siteDocsRoute from '@/app/api/site/documentos/route';
import * as siteDocRoute from '@/app/api/site/documentos/[tipo]/route';
import * as siteRascunhoRoute from '@/app/api/site/documentos/[tipo]/rascunho/route';
import * as sitePreviewRoute from '@/app/api/site/documentos/[tipo]/preview/route';
import * as sitePublicarRoute from '@/app/api/site/documentos/[tipo]/publicar/route';
import * as siteRollbackRoute from '@/app/api/site/documentos/[tipo]/rollback/route';
import * as siteAgendamentoRoute from '@/app/api/site/documentos/[tipo]/agendamento/route';
import * as siteRedirectsRoute from '@/app/api/site/redirects/route';
import * as siteRedirectRoute from '@/app/api/site/redirects/[id]/route';
import * as publicoSiteRoute from '@/app/api/publico/site/route';
import * as publicoSitemapRoute from '@/app/api/publico/site/sitemap/route';
import * as publicoRedirectsRoute from '@/app/api/publico/site/redirects/route';
import * as publicoAgendaRoute from '@/app/api/publico/agenda/route';
import { dispatchCommercial } from '@/app/api/_lib/commercial';
import { dispatchIntelligence } from '@/app/api/_lib/intelligence';
import type { CargoLinha, EmpresaDetalhe, MoveLinha, OrganizacaoLinha, PaginaDeCargos } from '@/lib/studio/intelligence-view';
import type { AlertaLinha, WatchlistItem, WatchlistLinha } from '@/lib/studio/watchlists-view';
import { dispatchTitular } from '@/app/api/_lib/titular-studio';
import type { AcaoDecisao, PedidoDetalhe, PedidoLinha } from '@/lib/studio/titular-view';
import type { Achado, Checklist, Fechamento, Leitura, MateriaId, MateriaPiloto } from '@/lib/studio/piloto-view';
import { dispatchEditorial } from '@/app/api/_lib/editorial';
import { chamar, type Despachante } from './backend';

type Handler = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const comParams = (h: Handler, params: Record<string, string>): Despachante => (req) => h(req, { params: Promise.resolve(params) });

export interface Fonte {
  id: string;
  nome: string;
  url: string;
  tipo: string;
  editorias: string[];
  acesso: string;
  termosRevisados: boolean;
  ativo: boolean;
}
export interface Evidencia {
  id: string;
  sourceId: string;
  url: string;
  capturadoEm: string;
  sha256: string;
}
export interface MateriaLinha {
  id: string;
  slug: string;
  titulo: string;
  editoria: string;
  status: string;
  versao: number;
  tipoConteudo: string;
  criadoEm: string;
}
export interface Transicao {
  id: string;
  de: string;
  para: string;
  actorId: string;
  nota: string | null;
  at: string;
}
export interface MateriaDetalhe extends MateriaLinha {
  subtitulo: string | null;
  resumo: string | null;
  corpo: string;
  imagem: { url: string; origem: string; credito: string; link?: string; baseDeDireito: string; textoAlternativo: string } | null;
  patrocinado: boolean;
  rotuloPublieditorial: string | null;
  assinatura: string;
  tempoLeituraMin: number;
  fontes: Evidencia[];
  publicadoEm?: string | null;
  recibo: { id: string; versao: number; aprovador: string; checagens: { tipo: string; resultado: string }[] } | null;
  transicoes: Transicao[];
}

export interface Pagina<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
export interface CampanhaLinha {
  id: string;
  name: string;
  status: string;
  formatId: string;
  formatName: string | null;
  positionId: string | null;
  startDate: string;
  endDate: string;
  accountId: string;
  accountName: string | null;
  sponsoredLabel: boolean;
}
export interface ContaLinha {
  id: string;
  name: string;
  createdAt: string;
  leads: number;
  opportunities: number;
  campaigns: number;
  activeCampaigns: number;
}

/** Formato de GET /api/publico/site (o que o Portal lê). Blocos já resolvidos pelo Backend. */
export type BlocoPublico =
  | { tipo: 'destaque'; id: string; titulo?: string; materias: { slug: string; titulo: string }[] }
  | { tipo: 'lista_editoria'; id: string; titulo?: string; editoria: string; limite: number; materias: { slug: string; titulo: string }[] }
  | { tipo: 'ultimas'; id: string; titulo?: string; limite: number; materias: { slug: string; titulo: string }[] }
  | { tipo: 'agenda'; id: string; titulo?: string; limite: number; eventos: { id: string; titulo: string }[] }
  | { tipo: 'publicidade'; id: string; posicao: string; dimensao?: unknown };
export interface SitePublico {
  home: { versao: number; blocos: BlocoPublico[] } | null;
  menus: { principal: { itens: { rotulo: string; destino: string; filhos?: { rotulo: string; destino: string }[] }[] } | null; rodape: { itens: { rotulo: string; destino: string; filhos?: { rotulo: string; destino: string }[] }[] } | null };
  seo: { tituloPadrao: string; descricaoPadrao: string; imagemOgUrl: string | null; indexacao: 'indexar' | 'noindex'; jsonLd: Record<string, unknown> } | null;
  linksInternos: { termo: string; destino: string }[];
}

export interface Revisao {
  id: string;
  articleId: string;
  casoId: string;
  baseVersao: number;
  versao: number;
  estado: 'rascunho' | 'aprovada' | 'publicada' | 'descartada';
  titulo: string;
  subtitulo: string | null;
  resumo: string | null;
  corpo: string;
  aviso: string;
  corpoFinal: string;
  receiptId: string | null;
  criadoEm: string;
}

export interface Midia {
  id: string;
  tipo: string;
  direitos: { url: string; origem: string; credito: string; link?: string; baseDeDireito: string; textoAlternativo: string };
  sha256: string;
  criadoEm: string;
  publicavel: boolean;
  licencaExpiraEm: string | null;
  licencaEvidencia: { tipo: string; referencia: string; descricao?: string } | null;
  /** sem_expiracao | valida | vence_em_breve | vencida */
  licencaStatus: string;
  temArquivo: boolean;
}
export interface EventoAgenda {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  local: string;
  url: string | null;
  editorias: string[];
  patrocinado: boolean;
  fonteUrl: string;
  moderacao: 'pendente' | 'aprovado' | 'rejeitado';
  motivoRejeicao: string | null;
  origem: 'interno' | 'publico';
}

const E = '/api/studio/editorial';
const C = '/api/commercial';
const I = '/api/studio/intelligence';
const T = '/api/studio/correcoes';
type ArquivoFolha = { nome: string; sha256: string; linhas: number };
/** O catch-all opcional lê o caminho de `params.path`, como o App Router entrega. */
const titularEm = (path: string[]): Despachante => (req) => dispatchTitular(req, { params: Promise.resolve({ path }) });

export const api = {
  materias: {
    listar: (query: Record<string, string | undefined>) => chamar<{ data: MateriaLinha[]; total: number }>(materiasRoute.GET as Despachante, '/api/materias', { query }),
    criar: (corpo: unknown) => chamar<{ data: MateriaDetalhe }>(materiasRoute.POST as Despachante, '/api/materias', { metodo: 'POST', corpo }),
    obter: (id: string) => chamar<{ data: MateriaDetalhe }>(comParams(materiaRoute.GET as Handler, { id }), `/api/materias/${id}`),
    atualizar: (id: string, corpo: unknown) => chamar<{ data: MateriaDetalhe }>(comParams(materiaRoute.PATCH as Handler, { id }), `/api/materias/${id}`, { metodo: 'PATCH', corpo }),
    definirFontes: (id: string, corpo: unknown) => chamar(comParams(materiaFontesRoute.PUT as Handler, { id }), `/api/materias/${id}/fontes`, { metodo: 'PUT', corpo }),
    emitirRecibo: (id: string, corpo: unknown) => chamar(comParams(materiaReciboRoute.POST as Handler, { id }), `/api/materias/${id}/recibos`, { metodo: 'POST', corpo }),
    transicao: (id: string, corpo: unknown) => chamar(comParams(materiaTransicaoRoute.POST as Handler, { id }), `/api/materias/${id}/transicao`, { metodo: 'POST', corpo }),
    /** Revisão de correção em aberto de matéria publicada (404 se não há). Criar/alterar é `atualizar` com casoCorrecaoId. */
    revisao: (id: string) => chamar<{ data: Revisao }>(comParams(materiaCorrecaoRoute.GET as Handler, { id }), `/api/materias/${id}/correcao`),
    descartarRevisao: (id: string) => chamar(comParams(materiaCorrecaoRoute.DELETE as Handler, { id }), `/api/materias/${id}/correcao`, { metodo: 'DELETE' }),
  },
  fontes: {
    listar: () => chamar<{ data: Fonte[] }>(fontesRoute.GET as Despachante, '/api/fontes'),
    criar: (corpo: unknown) => chamar<{ data: Fonte }>(fontesRoute.POST as Despachante, '/api/fontes', { metodo: 'POST', corpo }),
    atualizar: (id: string, corpo: unknown) => chamar<{ data: Fonte }>(comParams(fonteRoute.PATCH as Handler, { id }), `/api/fontes/${id}`, { metodo: 'PATCH', corpo }),
    evidencias: (id: string) => chamar<{ data: Evidencia[] }>(comParams(evidenciasRoute.GET as Handler, { id }), `/api/fontes/${id}/evidencias`),
    criarEvidencia: (id: string, corpo: unknown) => chamar<{ data: Evidencia }>(comParams(evidenciasRoute.POST as Handler, { id }), `/api/fontes/${id}/evidencias`, { metodo: 'POST', corpo }),
  },
  midia: {
    listar: (query: Record<string, string | undefined> = {}) => chamar<{ data: Midia[]; total: number }>(midiasRoute.GET as Despachante, '/api/midia', { query }),
    criar: (corpo: unknown) => chamar<{ data: Midia; deduplicada?: boolean }>(midiasRoute.POST as Despachante, '/api/midia', { metodo: 'POST', corpo }),
    atualizar: (id: string, corpo: unknown) => chamar<{ data: Midia }>(comParams(midiaRoute.PATCH as Handler, { id }), `/api/midia/${id}`, { metodo: 'PATCH', corpo }),
    /** Upload multipart (campos `arquivo` e `metadados`): tipo e hash vêm do CONTEÚDO; sem armazenamento S3 o Backend responde 503. */
    enviarArquivo: (form: FormData) => chamar<{ data: Midia; deduplicada?: boolean }>(midiaUploadRoute.POST as Despachante, '/api/midia/arquivo', { metodo: 'POST', form }),
    excluir: (id: string) => chamar(comParams(midiaRoute.DELETE as Handler, { id }), `/api/midia/${id}`, { metodo: 'DELETE' }),
  },
  agenda: {
    listar: (query: Record<string, string | undefined> = {}) => chamar<{ data: EventoAgenda[] }>(agendasRoute.GET as Despachante, '/api/agenda', { query }),
    criar: (corpo: unknown) => chamar<{ data: EventoAgenda }>(agendasRoute.POST as Despachante, '/api/agenda', { metodo: 'POST', corpo }),
    atualizar: (id: string, corpo: unknown) => chamar<{ data: EventoAgenda }>(comParams(agendaRoute.PATCH as Handler, { id }), `/api/agenda/${id}`, { metodo: 'PATCH', corpo }),
    excluir: (id: string) => chamar(comParams(agendaRoute.DELETE as Handler, { id }), `/api/agenda/${id}`, { metodo: 'DELETE' }),
    /** O que o Portal lê hoje (aprovados e não encerrados): GET /api/publico/agenda. */
    publica: () => chamar<{ data: { id: string; titulo: string; inicio: string; fim: string }[] }>(publicoAgendaRoute.GET as Despachante, '/api/publico/agenda'),
    moderar: (id: string, corpo: { estado: 'aprovado' | 'rejeitado'; motivo?: string }) => chamar<{ data: EventoAgenda }>(comParams(agendaModeracaoRoute.POST as Handler, { id }), `/api/agenda/${id}/moderacao`, { metodo: 'POST', corpo }),
  },
  site: {
    /** O que o Portal lê agora (versão em vigor, home já resolvida): GET /api/publico/site. */
    publico: () => chamar<{ data: SitePublico }>(publicoSiteRoute.GET as Despachante, '/api/publico/site'),
    publicoSitemap: () => chamar<{ data: { indexacao: string; urls: unknown[] } }>(publicoSitemapRoute.GET as Despachante, '/api/publico/site/sitemap'),
    publicoRedirects: () => chamar<{ data: { origem: string; destino: string; codigo: number }[] }>(publicoRedirectsRoute.GET as Despachante, '/api/publico/site/redirects'),
    documentos: () => chamar(siteDocsRoute.GET as Despachante, '/api/site/documentos'),
    documento: (tipo: string) => chamar(comParams(siteDocRoute.GET as Handler, { tipo }), `/api/site/documentos/${tipo}`),
    salvarRascunho: (tipo: string, conteudo: unknown) => chamar(comParams(siteRascunhoRoute.PUT as Handler, { tipo }), `/api/site/documentos/${tipo}/rascunho`, { metodo: 'PUT', corpo: { conteudo } }),
    preview: (tipo: string) => chamar(comParams(sitePreviewRoute.GET as Handler, { tipo }), `/api/site/documentos/${tipo}/preview`),
    publicar: (tipo: string, agendarPara?: string) => chamar(comParams(sitePublicarRoute.POST as Handler, { tipo }), `/api/site/documentos/${tipo}/publicar`, { metodo: 'POST', corpo: agendarPara ? { agendarPara } : {} }),
    cancelarAgendamento: (tipo: string) => chamar(comParams(siteAgendamentoRoute.DELETE as Handler, { tipo }), `/api/site/documentos/${tipo}/agendamento`, { metodo: 'DELETE' }),
    rollback: (tipo: string, versao: number) => chamar(comParams(siteRollbackRoute.POST as Handler, { tipo }), `/api/site/documentos/${tipo}/rollback`, { metodo: 'POST', corpo: { versao } }),
    redirects: () => chamar(siteRedirectsRoute.GET as Despachante, '/api/site/redirects'),
    criarRedirect: (corpo: unknown) => chamar(siteRedirectsRoute.POST as Despachante, '/api/site/redirects', { metodo: 'POST', corpo }),
    alterarRedirect: (id: string, corpo: unknown) => chamar(comParams(siteRedirectRoute.PATCH as Handler, { id }), `/api/site/redirects/${id}`, { metodo: 'PATCH', corpo }),
    excluirRedirect: (id: string) => chamar(comParams(siteRedirectRoute.DELETE as Handler, { id }), `/api/site/redirects/${id}`, { metodo: 'DELETE' }),
  },
  comercial: {
    formatos: (query: Record<string, string | undefined> = {}) => chamar(dispatchCommercial, `${C}/formats`, { query }),
    midiaKit: () => chamar(dispatchCommercial, `${C}/mediakit`),
    inventario: (from: string, to: string) => chamar(dispatchCommercial, `${C}/studio/inventory`, { query: { from, to } }),
    leads: (status?: string) => chamar(dispatchCommercial, `${C}/studio/leads`, { query: { status } }),
    /** Lead registrado pelo comercial: mesma rota pública do formulário do mídia kit (mesmas regras e consentimento gravado no servidor). */
    registrarLead: (corpo: unknown) => chamar(dispatchCommercial, `${C}/leads`, { metodo: 'POST', corpo }),
    qualificarLead: (leadId: string) => chamar(dispatchCommercial, `${C}/studio/leads/qualify`, { metodo: 'POST', corpo: { leadId } }),
    descartarLead: (leadId: string) => chamar(dispatchCommercial, `${C}/studio/leads/discard`, { metodo: 'POST', corpo: { leadId } }),
    converterLead: (leadId: string) => chamar(dispatchCommercial, `${C}/studio/leads/convert`, { metodo: 'POST', corpo: { leadId } }),
    oportunidades: () => chamar(dispatchCommercial, `${C}/studio/opportunities`),
    moverEstagio: (corpo: unknown) => chamar(dispatchCommercial, `${C}/studio/opportunities/stage`, { metodo: 'POST', corpo }),
    painel: (from: string, to: string) => chamar(dispatchCommercial, `${C}/studio/dashboard`, { query: { from, to } }),
    /** Lista paginada de campanhas (filtros status, accountId, q; limit/offset). Chaves em inglês, como o resto da API comercial. */
    campanhas: (query: Record<string, string | undefined> = {}) => chamar<Pagina<CampanhaLinha>>(dispatchCommercial, `${C}/studio/campaigns`, { query }),
    /** Contas/anunciantes: contagens, sem dado pessoal (filtro q; limit/offset). */
    contas: (query: Record<string, string | undefined> = {}) => chamar<Pagina<ContaLinha>>(dispatchCommercial, `${C}/studio/accounts`, { query }),
    criarCampanha: (corpo: unknown) => chamar(dispatchCommercial, `${C}/studio/campaigns`, { metodo: 'POST', corpo }),
    campanha: (campaignId: string) => chamar(dispatchCommercial, `${C}/studio/campaigns/detail`, { query: { campaignId } }),
    transicaoCampanha: (corpo: unknown) => chamar(dispatchCommercial, `${C}/studio/campaigns/transition`, { metodo: 'POST', corpo }),
    /** Relatório do anunciante (visíveis e cliques contados, origem, janela e data; nunca estimado). Janela opcional AAAA-MM-DD. */
    relatorio: (campaignId: string, from?: string, to?: string) => chamar(dispatchCommercial, `${C}/studio/campaigns/report`, { query: { campaignId, from, to } }),
    /** O mesmo relatório em CSV ('diario' ou 'resumo'): corpo { filename, contentType, csv }. */
    relatorioCsv: (campaignId: string, kind: 'diario' | 'resumo', from?: string, to?: string) => chamar(dispatchCommercial, `${C}/studio/campaigns/report-csv`, { query: { campaignId, kind, from, to } }),
  },
  intelligence: {
    /** Empresas por nome (GET /api/studio/intelligence/companies?q=). */
    empresas: (q: string) => chamar<{ items: OrganizacaoLinha[] }>(dispatchIntelligence, `${I}/companies`, { query: { q } }),
    /** Empresa com pessoas e cargos, relações e evidências. `includeInferred` traz também o que veio de fonte secundária ("a confirmar"). */
    empresa: (id: string, opts: { asOf?: string; includeInferred?: boolean } = {}) =>
      chamar<EmpresaDetalhe>(dispatchIntelligence, `${I}/companies/${encodeURIComponent(id)}`, { query: { asOf: opts.asOf, ...(opts.includeInferred ? { includeInferred: 'true' } : {}) } }),
    executivo: (id: string, opts: { includeInferred?: boolean } = {}) =>
      chamar<{ person: { id: string; full_name: string; public_profile_url: string | null; evidence: import('@/lib/studio/intelligence-view').EvidenciaRef }; roles: CargoLinha[] }>(
        dispatchIntelligence, `${I}/executives/${encodeURIComponent(id)}`, { query: opts.includeInferred ? { includeInferred: 'true' } : {} }),
    executivos: (q: string) => chamar<{ items: { id: string; full_name: string }[] }>(dispatchIntelligence, `${I}/executives`, { query: { q } }),
    /** Moves por estado (detected = pendente de revisão), com antes e depois quando o Backend os traz. */
    moves: (query: { status?: 'detected' | 'confirmed' | 'rejected'; organizationId?: string; personId?: string }) => chamar<{ items: MoveLinha[] }>(dispatchIntelligence, `${I}/moves`, { query }),
    /** Cargos abertos com nível da fonte: a fila "a confirmar" é certainty=inferred (ou source_level=secondary|inferred). */
    cargos: (query: { certainty?: 'declared' | 'inferred'; source_level?: string; organizationId?: string; q?: string; limit?: number; offset?: number }) =>
      chamar<PaginaDeCargos>(dispatchIntelligence, `${I}/roles`, { query: Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])) }),
    /** Confirma o cargo com a página OFICIAL (https, mesmo site da fonte oficial cadastrada da empresa; nunca LinkedIn/The Org). Editor ou superior. */
    confirmarCargo: (id: string, officialUrl: string) => chamar<{ id: string; certainty: string; source_level: string; confirmed_by: string }>(dispatchIntelligence, `${I}/roles/${encodeURIComponent(id)}/confirm`, { metodo: 'POST', corpo: { officialUrl } }),
    descartarCargo: (id: string, motivo: string) => chamar<{ id: string; discarded: boolean; discarded_by: string }>(dispatchIntelligence, `${I}/roles/${encodeURIComponent(id)}/discard`, { metodo: 'POST', corpo: { motivo } }),
    /** Pedido do titular (LGPD / direito de resposta): só admin. kind: access | rectification | suppression. */
    abrirPedido: (corpo: { personId: string; kind: 'access' | 'rectification' | 'suppression'; note?: string }) => chamar<{ id: string; status: string }>(dispatchIntelligence, `${I}/subject-requests`, { metodo: 'POST', corpo }),
    exportarPedido: (requestId: string) => chamar<{ requestId: string; data: { person: Record<string, unknown> | null; roles: Record<string, unknown>[] } }>(dispatchIntelligence, `${I}/subject-requests/${encodeURIComponent(requestId)}/export`, { metodo: 'POST', corpo: {} }),
    retificarPedido: (requestId: string, fullName: string) => chamar(dispatchIntelligence, `${I}/subject-requests/${encodeURIComponent(requestId)}/rectify`, { metodo: 'POST', corpo: { fullName } }),
    suprimirPedido: (requestId: string) => chamar(dispatchIntelligence, `${I}/subject-requests/${encodeURIComponent(requestId)}/suppress`, { metodo: 'POST', corpo: {} }),
    revisarMove: (id: string, status: 'confirmed' | 'rejected') => chamar(dispatchIntelligence, `${I}/moves/${encodeURIComponent(id)}/review`, { metodo: 'POST', corpo: { id, status } }),
    // ---- Watchlists e alertas (Studio 2; WATCHLISTS_API.md). Privadas: o dono é a sessão; lista de outro dono = 404. ----
    watchlists: () => chamar<{ items: WatchlistLinha[] }>(dispatchIntelligence, `${I}/watchlists`),
    watchlist: (id: string) => chamar<{ watchlist: WatchlistLinha; items: WatchlistItem[] }>(dispatchIntelligence, `${I}/watchlists/${encodeURIComponent(id)}`),
    criarWatchlist: (name: string) => chamar<{ id: string }>(dispatchIntelligence, `${I}/watchlists`, { metodo: 'POST', corpo: { name } }),
    apagarWatchlist: (id: string) => chamar<{ id: string; deleted: true }>(dispatchIntelligence, `${I}/watchlists/${encodeURIComponent(id)}`, { metodo: 'DELETE', corpo: { id } }),
    adicionarItem: (watchlistId: string, entityType: string, entityId: string) =>
      chamar<{ watchlistId: string; items: WatchlistItem[] }>(dispatchIntelligence, `${I}/watchlists/${encodeURIComponent(watchlistId)}/items`, { metodo: 'POST', corpo: { watchlistId, entityType, entityId } }),
    removerItem: (watchlistId: string, entityType: string, entityId: string) =>
      chamar<{ watchlistId: string; items: WatchlistItem[] }>(dispatchIntelligence, `${I}/watchlists/${encodeURIComponent(watchlistId)}/items`, { metodo: 'DELETE', corpo: { watchlistId, entityType, entityId } }),
    alertas: (query: { status?: 'pending_review' | 'approved' | 'rejected'; watchlistId?: string }) => chamar<{ items: AlertaLinha[] }>(dispatchIntelligence, `${I}/alerts`, { query }),
    revisarAlerta: (id: string, status: 'approved' | 'rejected') => chamar<{ id: string; status: string; reviewed_by: string }>(dispatchIntelligence, `${I}/alerts/${encodeURIComponent(id)}/review`, { metodo: 'POST', corpo: { id, status } }),
  },
  /** Pedidos do titular (DP-38; Studio 2): /api/studio/correcoes/[[...path]] (ft/backend-2). RBAC `titular`: editor-chefe e admin. */
  titular: {
    listar: (query: { estado?: string; responsavel?: string } = {}) => chamar<{ items: PedidoLinha[] }>(titularEm([]), T, { query }),
    /** Detalhe com nome, contato e trilha; a própria consulta entra na auditoria. */
    obter: (id: string) => chamar<PedidoDetalhe>(titularEm([id]), `${T}/${encodeURIComponent(id)}`),
    atribuir: (id: string, responsavel: string) => chamar<PedidoLinha>(titularEm([id, 'atribuir']), `${T}/${encodeURIComponent(id)}/atribuir`, { metodo: 'POST', corpo: { responsavel } }),
    decidir: (id: string, corpo: { acao: AcaoDecisao; campos?: Record<string, string>; motivo?: string }) =>
      chamar<PedidoLinha>(titularEm([id, 'decidir']), `${T}/${encodeURIComponent(id)}/decidir`, { metodo: 'POST', corpo }),
  },
  /**
   * Leitura do piloto de 10 matérias (Studio 2; PM-2026-11-23-C). Contrato da Editorial (packages/editorial/docs/piloto-leitura-api.md, ft/editorial ccfb23c),
   * rotas em /api/studio/editorial/piloto. O conteúdo de cada matéria vem de editorial.revisao. Leitura e mapa são imutáveis (409).
   */
  piloto: {
    materias: () => chamar<{ items: MateriaPiloto[]; fechamento?: Fechamento }>(dispatchEditorial, `${E}/piloto`),
    fixarMapa: (mapa: Partial<Record<MateriaId, string>>) => chamar<{ mapa: Record<string, string> }>(dispatchEditorial, `${E}/piloto/mapa`, { metodo: 'POST', corpo: mapa }),
    leituras: (materia: string) => chamar<{ materia: string; articleId: string; leituras: Leitura[]; ocultas: number }>(dispatchEditorial, `${E}/piloto/${encodeURIComponent(materia)}/leituras`),
    /** Registra só o hash da folha do leitor 2 no primeiro envio (sem conteúdo); 200 se o mesmo sha256 já estava; 409 FOLHA_DIFERENTE. */
    registrarFolha: (corpo: { arquivo: ArquivoFolha; leitor2Nome: string; materias: string[] }) =>
      chamar<{ registradoEm: string; sha256: string }>(dispatchEditorial, `${E}/piloto/importacao/registro`, { metodo: 'POST', corpo }),
    /** Importa as leituras do leitor 2 (tudo ou nada; 409 LEITOR1_PENDENTE, FOLHA_DIFERENTE). A resposta nunca traz o conteúdo. */
    importar: (corpo: { arquivo: ArquivoFolha; leitor2Nome: string; leituras: { materia: string; achados: Achado[]; checklist: Checklist; veredito: 'aprovado' | 'bloqueado' }[] }) =>
      chamar<{ importadas: { materia: string; unsupportedFacts: number; altas: number; medias: number; baixas: number }[] }>(dispatchEditorial, `${E}/piloto/importacao`, { metodo: 'POST', corpo }),
    registrar: (materia: string, corpo: { leitor: 1; achados: Achado[]; checklist: Checklist; veredito: 'aprovado' | 'bloqueado' }) =>
      chamar<{ materia: string; leitor: number; unsupportedFacts: number; altas: number; medias: number; baixas: number }>(dispatchEditorial, `${E}/piloto/${encodeURIComponent(materia)}/leitura`, { metodo: 'POST', corpo }),
  },
  editorial: {
    fila:(query: Record<string, string | undefined>) => chamar(dispatchEditorial, `${E}/queue`, { query }),
    /** Rascunho editorial completo + última checagem (para a correção de matéria da Fábrica; 404 sem registro editorial). */
    rascunho: (articleId: string) => chamar<RascunhoFabrica>(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/draft`),
    revisao: (articleId: string) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/review`),
    checagem: (articleId: string) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/factcheck`),
    rechecar: (articleId: string) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/recheck`, { metodo: 'POST', corpo: {} }),
    /** Rota oficial de publicação (flag publicacaoPortal; recibo da versão; identidade de publicação). A transição genérica não publica. */
    publicar: (articleId: string, corpo: { receiptId: string; url: string; correcao?: unknown }) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/publication`, { metodo: 'POST', corpo: { articleId, ...corpo } }),
    decidir: (articleId: string, corpo: unknown) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/review`, { metodo: 'POST', corpo }),
    correcoes: (query: Record<string, string | undefined>) => chamar(dispatchEditorial, `${E}/corrections`, { query }),
    correcao: (id: string) => chamar(dispatchEditorial, `${E}/corrections/${encodeURIComponent(id)}`),
    fontesRegistro: () => chamar(dispatchEditorial, `${E}/sources`),
    /** Pautas autorais (DP-29): fila com o estado e o resultado do worker. */
    pautas: () => chamar<{ items: PautaVista[] }>(dispatchEditorial, `${E}/pautas`),
    enviarPauta: (corpo: unknown) => chamar<{ id: string; estado: 'pendente' }>(dispatchEditorial, `${E}/pautas`, { metodo: 'POST', corpo }),
    abrirCorrecao: (corpo: unknown) => chamar(dispatchEditorial, `${E}/corrections`, { metodo: 'POST', corpo }),
    /** Passos do caso: verify-requester, preserve-evidence, triage, ack-legal, publish-notice, reconcile-social, entities-rebuilt, close. */
    passoCorrecao: (id: string, passo: string, corpo: unknown) => chamar(dispatchEditorial, `${E}/corrections/${encodeURIComponent(id)}/${passo}`, { metodo: 'POST', corpo }),
    revisarFonte: (sourceId: string, corpo: unknown) => chamar(dispatchEditorial, `${E}/sources/${encodeURIComponent(sourceId)}/review`, { metodo: 'POST', corpo }),
    habilitarFonte: (sourceId: string, enabled: boolean) => chamar(dispatchEditorial, `${E}/sources/${encodeURIComponent(sourceId)}/enabled`, { metodo: 'POST', corpo: { enabled } }),
  },
};
