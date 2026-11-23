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

const E = '/api/studio/editorial';

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
  editorial: {
    fila: (query: Record<string, string | undefined>) => chamar(dispatchEditorial, `${E}/queue`, { query }),
    revisao: (articleId: string) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/review`),
    checagem: (articleId: string) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/factcheck`),
    rechecar: (articleId: string) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/recheck`, { metodo: 'POST', corpo: {} }),
    decidir: (articleId: string, corpo: unknown) => chamar(dispatchEditorial, `${E}/articles/${encodeURIComponent(articleId)}/review`, { metodo: 'POST', corpo }),
    correcoes: (query: Record<string, string | undefined>) => chamar(dispatchEditorial, `${E}/corrections`, { query }),
    correcao: (id: string) => chamar(dispatchEditorial, `${E}/corrections/${encodeURIComponent(id)}`),
    fontesRegistro: () => chamar(dispatchEditorial, `${E}/sources`),
  },
};
