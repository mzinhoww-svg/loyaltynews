// Biblioteca de mídia (Blueprint §5, §6): ativo sempre com base de direito, texto alternativo e expiração opcional.
// Upload para o Blob não existe sem backend: aqui só se REGISTRA o ativo por URL, com evidência de licença.
import { ImageRights } from '@ln/contracts';
import { falha, normalizarUrl, relogioSistema, singleton, urlValida, type Auditoria, type Relogio, type Resultado } from './registros';

export interface MidiaInput {
  url: string;
  origem: string;
  credito: string;
  link?: string;
  baseDeDireito: string;
  textoAlternativo: string;
  /** Data (AAAA-MM-DD) de expiração da licença. */
  expiraEm?: string;
  /** Referência da evidência de licença (URL ou protocolo). */
  evidenciaLicenca?: string;
}

export interface MidiaRegistro extends MidiaInput {
  id: string;
  criadaEm: string;
}

export type EstadoUso = 'utilizavel' | 'expirada' | 'direito_pendente';

export function estadoDeUso(m: MidiaInput, hoje: string): EstadoUso {
  if (m.baseDeDireito === 'pendente') return 'direito_pendente';
  if (m.expiraEm && m.expiraEm < hoje) return 'expirada';
  return 'utilizavel';
}

export function validarMidia(i: MidiaInput): string[] {
  const e: string[] = [];
  if (!urlValida(i.url)) e.push('URL do ativo inválida.');
  if (i.link && !urlValida(i.link)) e.push('Link da fonte inválido.');
  if (i.expiraEm && !/^\d{4}-\d{2}-\d{2}$/.test(i.expiraEm)) e.push('Data de expiração inválida (AAAA-MM-DD).');
  if (i.baseDeDireito !== 'pendente' && i.baseDeDireito !== 'propria' && !(i.evidenciaLicenca ?? '').trim()) e.push('Base de direito de terceiro exige evidência de licença.');
  const p = ImageRights.safeParse({ url: i.url, origem: i.origem, credito: i.credito, link: i.link, baseDeDireito: i.baseDeDireito, textoAlternativo: i.textoAlternativo });
  if (!p.success) e.push(...p.error.issues.map((x) => `${x.path.join('.') || 'ativo'}: ${x.message}`));
  return e;
}

export class MidiaService {
  private readonly itens = new Map<string, MidiaRegistro>();
  readonly trilha: Auditoria[] = [];
  constructor(private readonly relogio: Relogio = relogioSistema) {}

  list(): MidiaRegistro[] {
    return [...this.itens.values()].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm)).map((m) => structuredClone(m));
  }

  registrar(quem: string, i: MidiaInput): Resultado<MidiaRegistro> {
    const erros = validarMidia(i);
    if (!erros.length && [...this.itens.values()].some((m) => normalizarUrl(m.url) === normalizarUrl(i.url))) erros.push('Ativo duplicado: esta URL já está na biblioteca.');
    if (erros.length) return falha(...erros);
    const agora = this.relogio.agora();
    const m: MidiaRegistro = { ...i, id: this.relogio.id(), criadaEm: agora };
    this.itens.set(m.id, m);
    this.trilha.push({ em: agora, quem, acao: 'midia_registrada', alvo: m.id, detalhe: i.url });
    return { ok: true, valor: structuredClone(m) };
  }

  remover(quem: string, id: string): Resultado<true> {
    if (!this.itens.delete(id)) return falha('Ativo não encontrado.');
    this.trilha.push({ em: this.relogio.agora(), quem, acao: 'midia_removida', alvo: id });
    return { ok: true, valor: true };
  }
}

export const getMidia = () => singleton('midia', () => new MidiaService());
