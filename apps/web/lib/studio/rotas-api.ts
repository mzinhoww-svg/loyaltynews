// Rotas reais do Backend usadas pelo Studio (chamadas em processo, com a sessão do usuário). Cada função repassa o cookie
// e devolve { status, body }; quem chama decide como mostrar erro, 503 "banco não configurado" e estados vazios.
import * as materiasRoute from '@/app/api/materias/route';
import * as materiaRoute from '@/app/api/materias/[id]/route';
import * as materiaFontesRoute from '@/app/api/materias/[id]/fontes/route';
import * as materiaReciboRoute from '@/app/api/materias/[id]/recibos/route';
import * as materiaTransicaoRoute from '@/app/api/materias/[id]/transicao/route';
import * as fontesRoute from '@/app/api/fontes/route';
import * as fonteRoute from '@/app/api/fontes/[id]/route';
import * as evidenciasRoute from '@/app/api/fontes/[id]/evidencias/route';
import * as midiasRoute from '@/app/api/midia/route';
import * as midiaRoute from '@/app/api/midia/[id]/route';
import * as agendasRoute from '@/app/api/agenda/route';
import * as agendaRoute from '@/app/api/agenda/[id]/route';
import { dispatchCommercial } from '@/app/api/_lib/commercial';
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
  recibo: { id: string; versao: number; aprovador: string; checagens: { tipo: string; resultado: string }[] } | null;
  transicoes: Transicao[];
}

export interface Midia {
  id: string;
  tipo: string;
  direitos: { url: string; origem: string; credito: string; link?: string; baseDeDireito: string; textoAlternativo: string };
  sha256: string;
  criadoEm: string;
  publicavel: boolean;
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
}

const E = '/api/studio/editorial';
const C = '/api/commercial';

export const api = {
  materias: {
    listar: (query: Record<string, string | undefined>) => chamar<{ data: MateriaLinha[]; total: number }>(materiasRoute.GET as Despachante, '/api/materias', { query }),
    criar: (corpo: unknown) => chamar<{ data: MateriaDetalhe }>(materiasRoute.POST as Despachante, '/api/materias', { metodo: 'POST', corpo }),
    obter: (id: string) => chamar<{ data: MateriaDetalhe }>(comParams(materiaRoute.GET as Handler, { id }), `/api/materias/${id}`),
    atualizar: (id: string, corpo: unknown) => chamar<{ data: MateriaDetalhe }>(comParams(materiaRoute.PATCH as Handler, { id }), `/api/materias/${id}`, { metodo: 'PATCH', corpo }),
    definirFontes: (id: string, corpo: unknown) => chamar(comParams(materiaFontesRoute.PUT as Handler, { id }), `/api/materias/${id}/fontes`, { metodo: 'PUT', corpo }),
    emitirRecibo: (id: string, corpo: unknown) => chamar(comParams(materiaReciboRoute.POST as Handler, { id }), `/api/materias/${id}/recibos`, { metodo: 'POST', corpo }),
    transicao: (id: string, corpo: unknown) => chamar(comParams(materiaTransicaoRoute.POST as Handler, { id }), `/api/materias/${id}/transicao`, { metodo: 'POST', corpo }),
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
    criar: (corpo: unknown) => chamar<{ data: Midia }>(midiasRoute.POST as Despachante, '/api/midia', { metodo: 'POST', corpo }),
    excluir: (id: string) => chamar(comParams(midiaRoute.DELETE as Handler, { id }), `/api/midia/${id}`, { metodo: 'DELETE' }),
  },
  agenda: {
    listar: (query: Record<string, string | undefined> = {}) => chamar<{ data: EventoAgenda[] }>(agendasRoute.GET as Despachante, '/api/agenda', { query }),
    criar: (corpo: unknown) => chamar<{ data: EventoAgenda }>(agendasRoute.POST as Despachante, '/api/agenda', { metodo: 'POST', corpo }),
    atualizar: (id: string, corpo: unknown) => chamar<{ data: EventoAgenda }>(comParams(agendaRoute.PATCH as Handler, { id }), `/api/agenda/${id}`, { metodo: 'PATCH', corpo }),
    excluir: (id: string) => chamar(comParams(agendaRoute.DELETE as Handler, { id }), `/api/agenda/${id}`, { metodo: 'DELETE' }),
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
    criarCampanha: (corpo: unknown) => chamar(dispatchCommercial, `${C}/studio/campaigns`, { metodo: 'POST', corpo }),
    campanha: (campaignId: string) => chamar(dispatchCommercial, `${C}/studio/campaigns/detail`, { query: { campaignId } }),
    transicaoCampanha: (corpo: unknown) => chamar(dispatchCommercial, `${C}/studio/campaigns/transition`, { metodo: 'POST', corpo }),
  },
  editorial: {
    fila: (query: Record<string, string | undefined>) => chamar(dispatchEditorial, `${E}/queue`, { query }),
    revisao: (articleId: string) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/review`),
    checagem: (articleId: string) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/factcheck`),
    rechecar: (articleId: string) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/recheck`, { metodo: 'POST', corpo: {} }),
    decidir: (articleId: string, corpo: unknown) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/review`, { metodo: 'POST', corpo }),
    correcoes: (query: Record<string, string | undefined>) => chamar(dispatchEditorial, `${E}/corrections`, { query }),
    correcao: (id: string) => chamar(dispatchEditorial, `${E}/corrections/${encodeURIComponent(id)}`),
    fontesRegistro: () => chamar(dispatchEditorial, `${E}/sources`),
    abrirCorrecao: (corpo: unknown) => chamar(dispatchEditorial, `${E}/corrections`, { metodo: 'POST', corpo }),
    /** Passos do caso: verify-requester, preserve-evidence, triage, ack-legal, publish-notice, reconcile-social, entities-rebuilt, close. */
    passoCorrecao: (id: string, passo: string, corpo: unknown) => chamar(dispatchEditorial, `${E}/corrections/${encodeURIComponent(id)}/${passo}`, { metodo: 'POST', corpo }),
    revisarFonte: (sourceId: string, corpo: unknown) => chamar(dispatchEditorial, `${E}/sources/${encodeURIComponent(sourceId)}/review`, { metodo: 'POST', corpo }),
    habilitarFonte: (sourceId: string, enabled: boolean) => chamar(dispatchEditorial, `${E}/sources/${encodeURIComponent(sourceId)}/enabled`, { metodo: 'POST', corpo: { enabled } }),
  },
};
