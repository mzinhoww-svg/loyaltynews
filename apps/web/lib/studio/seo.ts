// SEO (R3-05, Blueprint §5): redirecionamentos validados, URL canônica única, prévia do sitemap.
// Rascunho nunca entra em sitemap (regra R3-03): o sitemap daqui lista só rotas estruturais e as editorias.
import { EDITORIAS } from '@ln/contracts';
import { falha, relogioSistema, singleton, type Auditoria, type Relogio, type Resultado } from './registros';

export interface Redirecionamento {
  id: string;
  de: string;
  para: string;
  codigo: 301 | 302;
  criadoEm: string;
}

/** Rotas canônicas ativas do blueprint (§1): uma URL por conteúdo, sem duplicata indexável. */
export function rotasCanonicas(): string[] {
  return ['/', '/noticias', '/em-alta', '/busca', '/agenda', '/midia-kit', '/contato', '/sobre', '/privacidade', '/termos', '/publicidade', '/creditos-e-correcoes', ...EDITORIAS.map((e) => `/editoria/${e.slug}`)];
}

const CAMINHO = /^\/[A-Za-z0-9\-._~%/]*$/;

export function normalizarCaminho(v: string): string {
  const t = v.trim();
  return t.length > 1 ? t.replace(/\/+$/, '') : t;
}

export class SeoService {
  private readonly itens = new Map<string, Redirecionamento>();
  readonly trilha: Auditoria[] = [];
  constructor(private readonly relogio: Relogio = relogioSistema) {}

  list(): Redirecionamento[] {
    return [...this.itens.values()].sort((a, b) => a.de.localeCompare(b.de)).map((r) => structuredClone(r));
  }

  criar(quem: string, deRaw: string, paraRaw: string, codigo: number): Resultado<Redirecionamento> {
    const de = normalizarCaminho(deRaw);
    const para = normalizarCaminho(paraRaw);
    const erros: string[] = [];
    if (!CAMINHO.test(de)) erros.push('Origem inválida: use um caminho começando com / (sem domínio, query ou espaços).');
    if (!CAMINHO.test(para)) erros.push('Destino inválido: use um caminho começando com / (sem domínio, query ou espaços).');
    if (codigo !== 301 && codigo !== 302) erros.push('Código deve ser 301 ou 302.');
    if (!erros.length) {
      if (de === para) erros.push('Origem e destino não podem ser iguais.');
      if (rotasCanonicas().includes(de)) erros.push('A origem é uma rota canônica ativa: redirecioná-la tiraria a página do ar.');
      if ([...this.itens.values()].some((r) => r.de === de)) erros.push('Já existe redirecionamento para esta origem.');
      if (this.formariaCiclo(de, para)) erros.push('Este redirecionamento formaria um ciclo.');
    }
    if (erros.length) return falha(...erros);
    const r: Redirecionamento = { id: this.relogio.id(), de, para, codigo: codigo as 301 | 302, criadoEm: this.relogio.agora() };
    this.itens.set(r.id, r);
    this.trilha.push({ em: r.criadoEm, quem, acao: 'redirect_criado', alvo: r.id, detalhe: `${de} → ${para} (${codigo})` });
    return { ok: true, valor: structuredClone(r) };
  }

  remover(quem: string, id: string): Resultado<true> {
    if (!this.itens.delete(id)) return falha('Redirecionamento não encontrado.');
    this.trilha.push({ em: this.relogio.agora(), quem, acao: 'redirect_removido', alvo: id });
    return { ok: true, valor: true };
  }

  private formariaCiclo(de: string, para: string): boolean {
    const mapa = new Map([...this.itens.values()].map((r) => [r.de, r.para] as const));
    mapa.set(de, para);
    const visto = new Set<string>();
    let atual: string | undefined = de;
    while (atual !== undefined) {
      if (visto.has(atual)) return true;
      visto.add(atual);
      atual = mapa.get(atual);
    }
    return false;
  }

  /** Cadeias com mais de um salto: aviso (o destino final deveria ser usado direto). */
  cadeias(): string[] {
    const mapa = new Map([...this.itens.values()].map((r) => [r.de, r.para] as const));
    return [...mapa.entries()].filter(([, para]) => mapa.has(para)).map(([de, para]) => `${de} → ${para} → ${mapa.get(para)}`);
  }
}

export const getSeo = () => singleton('seo', () => new SeoService());
