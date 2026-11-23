// Agenda e eventos (R3-04, Blueprint §5): evento só com fonte oficial, moderação, evento passado sai da lista.
import { AgendaEvent, EDITORIAS } from '@ln/contracts';
import { falha, relogioSistema, singleton, type Auditoria, type Relogio, type Resultado } from './registros';

export type Moderacao = 'pendente' | 'aprovado' | 'rejeitado';

export interface EventoInput {
  titulo: string;
  inicio: string;
  fim: string;
  local: string;
  url?: string;
  editorias: string[];
  patrocinado: boolean;
  fonteUrl: string;
}

export interface EventoRegistro extends EventoInput {
  id: string;
  moderacao: Moderacao;
  motivoRejeicao?: string;
  criadoEm: string;
}

const SLUGS = EDITORIAS.map((e) => e.slug) as readonly string[];

export function validarEvento(i: EventoInput): string[] {
  const e: string[] = [];
  if (i.editorias.some((s) => !SLUGS.includes(s))) e.push('Editoria desconhecida.');
  const p = AgendaEvent.safeParse({ id: 'novo', titulo: i.titulo.trim(), inicio: i.inicio, fim: i.fim, local: i.local.trim(), url: i.url || undefined, editorias: i.editorias, patrocinado: i.patrocinado, fonteUrl: i.fonteUrl });
  if (!p.success) {
    for (const x of p.error.issues) {
      const campo = x.path[0];
      e.push(campo === 'fonteUrl' ? 'Fonte oficial obrigatória (URL válida): evento só entra com fonte oficial.' : `${String(campo ?? 'evento')}: ${x.message}`);
    }
  }
  return e;
}

/** Hoje no fuso de São Paulo, em AAAA-MM-DD. */
export function hojeSP(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

export class AgendaService {
  private readonly itens = new Map<string, EventoRegistro>();
  readonly trilha: Auditoria[] = [];
  constructor(private readonly relogio: Relogio = relogioSistema) {}

  criar(quem: string, i: EventoInput): Resultado<EventoRegistro> {
    const erros = validarEvento(i);
    if (erros.length) return falha(...erros);
    const agora = this.relogio.agora();
    const ev: EventoRegistro = { ...i, titulo: i.titulo.trim(), local: i.local.trim(), id: this.relogio.id(), moderacao: 'pendente', criadoEm: agora };
    this.itens.set(ev.id, ev);
    this.trilha.push({ em: agora, quem, acao: 'evento_criado', alvo: ev.id, detalhe: ev.titulo });
    return { ok: true, valor: structuredClone(ev) };
  }

  moderar(quem: string, id: string, decisao: 'aprovado' | 'rejeitado', motivo = ''): Resultado<EventoRegistro> {
    const ev = this.itens.get(id);
    if (!ev) return falha('Evento não encontrado.');
    if (decisao === 'rejeitado' && !motivo.trim()) return falha('Informe o motivo da rejeição.');
    ev.moderacao = decisao;
    if (decisao === 'rejeitado') ev.motivoRejeicao = motivo.trim();
    else delete ev.motivoRejeicao;
    this.trilha.push({ em: this.relogio.agora(), quem, acao: `evento_${decisao}`, alvo: id, ...(motivo ? { detalhe: motivo.trim() } : {}) });
    return { ok: true, valor: structuredClone(ev) };
  }

  /** Eventos que ainda não terminaram (fim >= hoje), ordenados por início. */
  proximos(hoje: string): EventoRegistro[] {
    return [...this.itens.values()].filter((e) => e.fim >= hoje).sort((a, b) => a.inicio.localeCompare(b.inicio)).map((e) => structuredClone(e));
  }
  /** Eventos já encerrados: fora da lista pública, mantidos como arquivo. */
  passados(hoje: string): EventoRegistro[] {
    return [...this.itens.values()].filter((e) => e.fim < hoje).sort((a, b) => b.fim.localeCompare(a.fim)).map((e) => structuredClone(e));
  }
}

export const getAgenda = () => singleton('agenda', () => new AgendaService());
