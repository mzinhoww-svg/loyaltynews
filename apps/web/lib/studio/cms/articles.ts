// Núcleo do CMS editorial do LN Studio (R3-06/R3-07): matéria com versões imutáveis, checagem automática,
// aprovação ligada à versão e histórico. Sem backend: repositório em memória (interface ArticleRepository),
// a ser substituído por @ln/db pelo Backend. Dado começa VAZIO (sem matéria fictícia).
import { ASSINATURA, EDITORIAS, ImageRights, isImagePublishable, type ArticleStatus, type EditoriaSlug } from '@ln/contracts';

export interface SourceInput {
  nome: string;
  url: string;
}

export interface ImageInput {
  url: string;
  origem: string;
  credito: string;
  link?: string;
  baseDeDireito: string;
  textoAlternativo: string;
}

export interface VersionInput {
  titulo: string;
  subtitulo?: string;
  corpo: string;
  editoria: string;
  fontes: SourceInput[];
  imagem?: ImageInput;
  patrocinado: boolean;
  rotuloPublieditorial?: string;
}

export interface ArticleVersion extends VersionInput {
  numero: number;
  autor: string;
  criadaEm: string;
  nota?: string;
}

export interface AuditEntry {
  em: string;
  quem: string;
  acao: string;
  versao: number;
  detalhe?: string;
}

export interface Approval {
  versao: number;
  por: string;
  em: string;
}

export interface ArticleRecord {
  id: string;
  slug: string;
  status: ArticleStatus;
  assinatura: typeof ASSINATURA;
  versoes: ArticleVersion[];
  aprovacao?: Approval;
  motivoBloqueio?: string;
  criadaEm: string;
  atualizadaEm: string;
  historico: AuditEntry[];
}

export type Severity = 'bloqueio' | 'aviso';
export interface CheckIssue {
  campo: string;
  severidade: Severity;
  mensagem: string;
}

const EDITORIA_SLUGS = EDITORIAS.map((e) => e.slug) as readonly string[];

export function editoriaNome(slug: string): string {
  return EDITORIAS.find((e) => e.slug === slug)?.nome ?? slug;
}

function isUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Valida os campos mínimos para salvar um rascunho (erros de formato, não de qualidade). */
export function validateDraft(v: VersionInput): CheckIssue[] {
  const out: CheckIssue[] = [];
  if (!v.titulo.trim()) out.push({ campo: 'titulo', severidade: 'bloqueio', mensagem: 'Título obrigatório.' });
  if (v.titulo.length > 200) out.push({ campo: 'titulo', severidade: 'bloqueio', mensagem: 'Título com mais de 200 caracteres.' });
  if ((v.subtitulo ?? '').length > 300) out.push({ campo: 'subtitulo', severidade: 'bloqueio', mensagem: 'Subtítulo com mais de 300 caracteres.' });
  if (!EDITORIA_SLUGS.includes(v.editoria)) out.push({ campo: 'editoria', severidade: 'bloqueio', mensagem: 'Escolha uma das dez editorias.' });
  for (const [i, f] of v.fontes.entries()) {
    if (f.url && !isUrl(f.url)) out.push({ campo: `fontes.${i}.url`, severidade: 'bloqueio', mensagem: `Fonte ${i + 1}: URL inválida.` });
  }
  if (v.imagem?.link && !isUrl(v.imagem.link)) out.push({ campo: 'imagem.link', severidade: 'bloqueio', mensagem: 'Link da fonte da imagem inválido.' });
  if (v.imagem?.url && !isUrl(v.imagem.url)) out.push({ campo: 'imagem.url', severidade: 'bloqueio', mensagem: 'URL da imagem inválida.' });
  return out;
}

/** Checagem automática para entrar na fila de revisão (Blueprint §6: na dúvida, não publica). */
export function checkVersion(v: VersionInput): CheckIssue[] {
  const out = validateDraft(v);
  if (!v.corpo.trim()) out.push({ campo: 'corpo', severidade: 'bloqueio', mensagem: 'Corpo da matéria vazio.' });
  const fontesOk = v.fontes.filter((f) => f.nome.trim() && isUrl(f.url));
  if (fontesOk.length === 0) out.push({ campo: 'fontes', severidade: 'bloqueio', mensagem: 'Matéria sem fonte verificável (nome e URL).' });
  for (const [i, f] of v.fontes.entries()) {
    if ((f.nome.trim() && !f.url.trim()) || (!f.nome.trim() && f.url.trim())) {
      out.push({ campo: `fontes.${i}`, severidade: 'bloqueio', mensagem: `Fonte ${i + 1}: preencha nome e URL.` });
    }
  }
  if (v.imagem && (v.imagem.url || v.imagem.credito || v.imagem.textoAlternativo)) {
    const parsed = ImageRights.safeParse(v.imagem);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        out.push({ campo: `imagem.${issue.path.join('.') || 'geral'}`, severidade: 'bloqueio', mensagem: `Imagem: ${issue.message}` });
      }
    } else if (!isImagePublishable(parsed.data)) {
      out.push({ campo: 'imagem.baseDeDireito', severidade: 'bloqueio', mensagem: 'Imagem sem base de direito demonstrável não segue (pendente).' });
    }
  } else {
    out.push({ campo: 'imagem', severidade: 'aviso', mensagem: 'Matéria sem imagem.' });
  }
  if (v.patrocinado && !(v.rotuloPublieditorial ?? '').trim()) {
    out.push({ campo: 'rotuloPublieditorial', severidade: 'bloqueio', mensagem: 'Conteúdo pago exige rótulo publieditorial.' });
  }
  return out;
}

export const hasBlockers = (issues: CheckIssue[]) => issues.some((i) => i.severidade === 'bloqueio');

export function slugify(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export type ServiceError = { ok: false; code: 'NAO_ENCONTRADA' | 'VALIDACAO' | 'ESTADO_INVALIDO' | 'QUATRO_OLHOS' | 'MOTIVO_OBRIGATORIO'; issues?: CheckIssue[]; mensagem: string };
export type ServiceResult<T = ArticleRecord> = { ok: true; value: T } | ServiceError;

export interface ArticleRepository {
  list(): ArticleRecord[];
  get(id: string): ArticleRecord | undefined;
  save(record: ArticleRecord): void;
}

export class MemoryArticleRepository implements ArticleRepository {
  private readonly items = new Map<string, ArticleRecord>();
  list() {
    return [...this.items.values()].map((r) => structuredClone(r));
  }
  get(id: string) {
    const r = this.items.get(id);
    return r ? structuredClone(r) : undefined;
  }
  save(record: ArticleRecord) {
    this.items.set(record.id, structuredClone(record));
  }
}

export interface Clock {
  now(): string;
  id(): string;
}
export const systemClock: Clock = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };

export const currentVersion = (r: ArticleRecord): ArticleVersion => r.versoes[r.versoes.length - 1]!;

export class CmsService {
  constructor(
    private readonly repo: ArticleRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  list(): ArticleRecord[] {
    return this.repo.list().sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm));
  }

  get(id: string) {
    return this.repo.get(id);
  }

  create(actor: string, input: VersionInput): ServiceResult {
    const issues = validateDraft(input).filter((i) => i.severidade === 'bloqueio');
    if (issues.length) return { ok: false, code: 'VALIDACAO', issues, mensagem: 'Corrija os campos destacados.' };
    const now = this.clock.now();
    const id = this.clock.id();
    const base = slugify(input.titulo) || 'materia';
    const used = new Set(this.repo.list().map((r) => r.slug));
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    const rec: ArticleRecord = {
      id,
      slug,
      status: 'rascunho',
      assinatura: ASSINATURA,
      versoes: [{ ...input, numero: 1, autor: actor, criadaEm: now }],
      criadaEm: now,
      atualizadaEm: now,
      historico: [{ em: now, quem: actor, acao: 'criada', versao: 1 }],
    };
    this.repo.save(rec);
    return { ok: true, value: rec };
  }

  /** Editar NUNCA sobrescreve: gera nova versão e volta o estado para rascunho (aprovação anterior deixa de valer). */
  edit(actor: string, id: string, input: VersionInput, nota?: string): ServiceResult {
    const rec = this.repo.get(id);
    if (!rec) return { ok: false, code: 'NAO_ENCONTRADA', mensagem: 'Matéria não encontrada.' };
    if (rec.status === 'publicado') return { ok: false, code: 'ESTADO_INVALIDO', mensagem: 'Matéria publicada só muda por correção versionada (fora deste bloco).' };
    const issues = validateDraft(input).filter((i) => i.severidade === 'bloqueio');
    if (issues.length) return { ok: false, code: 'VALIDACAO', issues, mensagem: 'Corrija os campos destacados.' };
    const now = this.clock.now();
    const numero = currentVersion(rec).numero + 1;
    rec.versoes.push({ ...input, numero, autor: actor, criadaEm: now, ...(nota ? { nota } : {}) });
    rec.status = 'rascunho';
    delete rec.aprovacao;
    delete rec.motivoBloqueio;
    rec.atualizadaEm = now;
    rec.historico.push({ em: now, quem: actor, acao: 'editada', versao: numero, ...(nota ? { detalhe: nota } : {}) });
    this.repo.save(rec);
    return { ok: true, value: rec };
  }

  submitForReview(actor: string, id: string): ServiceResult<{ record: ArticleRecord; issues: CheckIssue[] }> {
    const rec = this.repo.get(id);
    if (!rec) return { ok: false, code: 'NAO_ENCONTRADA', mensagem: 'Matéria não encontrada.' };
    if (rec.status !== 'rascunho') return { ok: false, code: 'ESTADO_INVALIDO', mensagem: 'Só rascunho vai para checagem.' };
    const v = currentVersion(rec);
    const issues = checkVersion(v);
    if (hasBlockers(issues)) return { ok: false, code: 'VALIDACAO', issues, mensagem: 'A checagem automática encontrou bloqueios.' };
    const now = this.clock.now();
    rec.status = 'em_checagem';
    rec.atualizadaEm = now;
    rec.historico.push({ em: now, quem: actor, acao: 'enviada_para_checagem', versao: v.numero });
    this.repo.save(rec);
    return { ok: true, value: { record: rec, issues } };
  }

  /** Aprovação vale para a versão checada e exige identidade diferente da do autor da versão (quatro olhos). */
  approve(actor: string, id: string, versaoAprovada: number): ServiceResult {
    const rec = this.repo.get(id);
    if (!rec) return { ok: false, code: 'NAO_ENCONTRADA', mensagem: 'Matéria não encontrada.' };
    if (rec.status !== 'em_checagem') return { ok: false, code: 'ESTADO_INVALIDO', mensagem: 'Só matéria em checagem pode ser aprovada.' };
    const v = currentVersion(rec);
    if (v.numero !== versaoAprovada) return { ok: false, code: 'ESTADO_INVALIDO', mensagem: `Aprovação de versão antiga (v${versaoAprovada}); a vigente é v${v.numero}.` };
    if (v.autor === actor) return { ok: false, code: 'QUATRO_OLHOS', mensagem: 'O autor da versão não pode aprová-la.' };
    if (hasBlockers(checkVersion(v))) return { ok: false, code: 'VALIDACAO', mensagem: 'Checagem automática com bloqueios.' };
    const now = this.clock.now();
    rec.status = 'aprovado';
    rec.aprovacao = { versao: v.numero, por: actor, em: now };
    rec.atualizadaEm = now;
    rec.historico.push({ em: now, quem: actor, acao: 'aprovada', versao: v.numero });
    this.repo.save(rec);
    return { ok: true, value: rec };
  }

  block(actor: string, id: string, motivo: string): ServiceResult {
    const rec = this.repo.get(id);
    if (!rec) return { ok: false, code: 'NAO_ENCONTRADA', mensagem: 'Matéria não encontrada.' };
    if (rec.status !== 'em_checagem') return { ok: false, code: 'ESTADO_INVALIDO', mensagem: 'Só matéria em checagem pode ser bloqueada.' };
    if (!motivo.trim()) return { ok: false, code: 'MOTIVO_OBRIGATORIO', mensagem: 'Informe o motivo do bloqueio.' };
    const now = this.clock.now();
    rec.status = 'bloqueado';
    rec.motivoBloqueio = motivo.trim();
    rec.atualizadaEm = now;
    rec.historico.push({ em: now, quem: actor, acao: 'bloqueada', versao: currentVersion(rec).numero, detalhe: motivo.trim() });
    this.repo.save(rec);
    return { ok: true, value: rec };
  }

  /** Bloqueado ou aprovado volta ao rascunho (cria nova versão cópia, preservando o histórico). */
  reopen(actor: string, id: string): ServiceResult {
    const rec = this.repo.get(id);
    if (!rec) return { ok: false, code: 'NAO_ENCONTRADA', mensagem: 'Matéria não encontrada.' };
    if (rec.status !== 'bloqueado' && rec.status !== 'aprovado') return { ok: false, code: 'ESTADO_INVALIDO', mensagem: 'Só matéria bloqueada ou aprovada pode ser reaberta.' };
    const cur = currentVersion(rec);
    const { numero: _n, autor: _a, criadaEm: _c, nota: _nota, ...input } = cur;
    return this.edit(actor, id, input, `reaberta de v${cur.numero}`);
  }
}

const g = globalThis as unknown as { __lnStudioCms?: CmsService };

/** Instância única por processo (estado temporário; some ao reiniciar). */
export function getCmsService(): CmsService {
  g.__lnStudioCms ??= new CmsService(new MemoryArticleRepository());
  return g.__lnStudioCms;
}

export const STATUS_LABEL: Record<ArticleStatus, string> = {
  rascunho: 'Rascunho',
  em_checagem: 'Em checagem',
  bloqueado: 'Bloqueado',
  aprovado: 'Aprovado',
  publicado: 'Publicado',
  despublicado: 'Despublicado',
  corrigido: 'Corrigido',
};

export type { ArticleStatus, EditoriaSlug };
