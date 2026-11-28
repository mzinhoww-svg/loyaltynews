import { attributionNameOf } from '../collector/allowlist';
import { BLOG_ANCHOR_ALLOWLIST, isPermittedBlogAnchor } from './blog-anchor';
import type { CheckResult, Claim, Draft, Evidence, Finding, ImageDecision, RightsBasisKind, Source } from '../types';
import { SIGNATURE } from '../types';
import { normalizeText } from '../dedupe/dedupe';
import { parseNotices } from '../notices';
import { ContentType } from '@ln/contracts';
import { RESUMO_MAX, SLUG_MAX, SLUG_RE } from '../publishable';
import { checkTone } from './tone';

/**
 * Regras editoriais determinísticas (sem LLM). O modelo propõe; estas regras decidem. Fail closed.
 * Princípio: nunca inventar fala, fonte, entrevista, apuração presencial, autoria humana ou métrica.
 */

const BASIS_KINDS: readonly RightsBasisKind[] = ['license', 'authorization', 'public_domain', 'validated_exception'];

/** Linguagem que simula apuração própria, entrevista ou autoria humana. Nenhuma evidência do tipo existe no sistema. */
const FABRICATED_REPORTING: RegExp[] = [
  /em entrevista (exclusiva )?(à|a|ao|para)\s/i,
  /(nossa|a) reportagem (esteve|conversou|apurou|ouviu|entrou em contato|procurou|teve acesso)/i,
  /apura[çc][ãa]o (presencial|exclusiva|in loco)/i,
  /\bconversamos com\b|\bouvimos\b|\bprocuramos\b|\bfalamos com\b/i,
  /(procurad[ao]s? pela|procuramos a) reda[çc][ãa]o/i,
  /\bexclusivo\b.{0,20}\bLoyalty News\b/i,
  /(enviado especial|nosso correspondente|nossa rep[óo]rter|nosso rep[óo]rter)/i,
];
const BYLINE = /^\s*([Pp]or|[Tt]exto( de)?|[Rr]eportagem( de)?|[Rr]ep[óo]rter|[Aa]utor(a)?)\s*[:\-–]?\s+[A-ZÀ-Ú][a-zà-ú]+(\s+[A-ZÀ-Ú][a-zà-ú]+)+/m;

/** Corpo sem os blocos gerados pelo sistema: "Avisos:" (errata/resposta publicadas) e "Fontes:" (URLs e datas de acesso). */
export function mainBody(body: string): string { return body.split(/\n\n(?:Avisos|Fontes):\n/)[0]!; }

function f(code: string, message: string, claimId?: string): Finding {
  return claimId ? { code, message, claimId } : { code, message };
}

function result(findings: Finding[]): CheckResult {
  return { verdict: findings.length ? 'fail' : 'pass', findings };
}

/**
 * Conteúdo SIMULADO (ensaio com modelo simulado) nunca é publicável: o marcador "SIMULADO" no título, resumo ou texto bloqueia a
 * PUBLICAÇÃO (não a aprovação, que o ensaio local precisa exercitar). Usado por applyPublication e publishApproved.
 */
export const SIMULATED_MARKER = /\bSIMULADO\b/;
export const isSimulatedContent = (d: Pick<Draft, 'headline' | 'resumo' | 'body'>): boolean => SIMULATED_MARKER.test(`${d.headline}\n${d.resumo ?? ''}\n${d.body}`);

export function checkSignature(d: Draft): CheckResult {
  const out: Finding[] = [];
  if (d.signature !== SIGNATURE) out.push(f('bad_signature', `assinatura deve ser exatamente "${SIGNATURE}"`));
  if (BYLINE.test(d.body)) out.push(f('invented_byline', 'texto contém assinatura/byline de pessoa; só "Redação Loyalty News" é permitido'));
  return result(out);
}

export function fabricatedReportingFindings(text: string): Finding[] {
  const out: Finding[] = [];
  for (const re of FABRICATED_REPORTING) if (re.test(text)) out.push(f("fabricated_reporting", `linguagem de apuração/entrevista própria não suportada: ${re.source}`));
  return out;
}

export function checkNoFabricatedReporting(d: Draft): CheckResult {
  const out: Finding[] = [];
  const text = `${d.headline}\n${d.subtitulo ?? ''}\n${d.resumo ?? ''}\n${d.body}`;
  for (const re of FABRICATED_REPORTING) if (re.test(text)) out.push(f('fabricated_reporting', `linguagem de apuração/entrevista própria não suportada: ${re.source}`));
  return result(out);
}

const NUM = /\d[\d.,]*/g;
export function numbersIn(s: string): string[] {
  return (s.match(NUM) ?? []).map((n) => n.replace(/[.,]+$/, '')).filter(Boolean);
}
export function digitsKey(n: string): string { return n.replace(/[^\d]/g, ''); }

function evidenceText(evs: Evidence[]): string { return evs.map((e) => `${e.title}\n${e.text}`).join('\n'); }

/** Cada claim cita evidências existentes; citações literais e números precisam constar na evidência citada. */
export function checkClaims(d: Draft, evidences: Evidence[]): CheckResult {
  const out: Finding[] = [];
  const byId = new Map(evidences.map((e) => [e.id, e]));
  for (const id of d.evidenceIds) if (!byId.has(id)) out.push(f('unknown_evidence', `evidência inexistente: ${id}`));
  if (!d.claims.length) out.push(f('no_claims', 'matéria sem claims verificáveis'));
  for (const c of d.claims) {
    if (!c.evidenceIds.length) { out.push(f('unsupported_claim', 'claim sem evidência', c.id)); continue; }
    const evs = c.evidenceIds.map((i) => byId.get(i));
    if (evs.some((e) => !e)) { out.push(f('unknown_evidence', 'claim cita evidência inexistente', c.id)); continue; }
    const text = normalizeText(evidenceText(evs as Evidence[]));
    if (c.kind === 'quote') {
      if (!c.quote?.text || !c.quote.speaker) { out.push(f('invented_quote', 'citação sem texto/autor', c.id)); continue; }
      if (!text.includes(normalizeText(c.quote.text))) out.push(f('invented_quote', 'citação não consta literalmente na evidência', c.id));
      if (!text.includes(normalizeText(c.quote.speaker))) out.push(f('invented_quote', 'autor da fala não consta na evidência', c.id));
    }
    if (c.kind === 'number' || c.kind === 'date') {
      const evNums = new Set(numbersIn(evidenceText(evs as Evidence[])).map(digitsKey));
      for (const n of numbersIn(c.text)) if (!evNums.has(digitsKey(n))) out.push(f('unsupported_metric', `número "${n}" não consta na evidência`, c.id));
    }
  }
  return result(out);
}

/** Todo número e toda citação entre aspas do corpo precisam constar nas evidências do rascunho. */
export function checkBodyGrounding(d: Draft, evidences: Evidence[]): CheckResult {
  const out: Finding[] = [];
  const used = evidences.filter((e) => d.evidenceIds.includes(e.id));
  const evNorm = normalizeText(evidenceText(used));
  const evNums = new Set(numbersIn(evidenceText(used)).map(digitsKey));
  const visible = [mainBody(d.body), d.resumo ?? '', d.subtitulo ?? ''];
  for (const n of numbersIn(`${d.headline} ${visible.join(' ')}`)) {
    if (!evNums.has(digitsKey(n))) out.push(f('unsupported_metric', `número "${n}" no texto não consta nas evidências`));
  }
  for (const part of visible) {
    for (const m of part.matchAll(/["“]([^"”]{12,})["”]/g)) {
      if (!evNorm.includes(normalizeText(m[1]!))) out.push(f('invented_quote', `trecho entre aspas não consta literalmente nas evidências: "${m[1]!.slice(0, 40)}…"`));
    }
  }
  return result(out);
}

function words(s: string): string[] { return normalizeText(s).split(' ').filter(Boolean); }

/** Maior sequência de palavras consecutivas em comum. */
export function longestCommonRun(a: string[], b: string[]): number {
  let best = 0;
  const idx = new Map<string, number[]>();
  b.forEach((w, i) => { const l = idx.get(w); if (l) l.push(i); else idx.set(w, [i]); });
  for (let i = 0; i < a.length; i++) {
    for (const j of idx.get(a[i]!) ?? []) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

export const COPY_RUN_LIMIT = 8;
export const COPY_RATIO_LIMIT = 0.3;
/** DP-29 ("nunca reproduzir"): blogs e imprensa de nicho (fonte secundária) têm limite de cópia mais rígido. */
export const COPY_RUN_LIMIT_SECONDARY = 6;
export const COPY_RATIO_LIMIT_SECONDARY = 0.2;
const isSecondary = (e: Evidence): boolean => e.sourceTier === 'secondary';

/** Gate de originalidade: trechos entre aspas (fala literal verificada) são excluídos da comparação. */
export function checkOriginality(d: Draft, evidences: Evidence[]): CheckResult {
  const out: Finding[] = [];
  const bodyNoQuotes = mainBody(d.body).replace(/["“][^"”]*["”]/g, ' ');
  const bw = words(bodyNoQuotes);
  for (const e of evidences.filter((x) => d.evidenceIds.includes(x.id))) {
    const ew = words(e.text);
    const runLimit = isSecondary(e) ? COPY_RUN_LIMIT_SECONDARY : COPY_RUN_LIMIT;
    const ratioLimit = isSecondary(e) ? COPY_RATIO_LIMIT_SECONDARY : COPY_RATIO_LIMIT;
    for (const [label, txt] of [['resumo', d.resumo], ['subtitulo', d.subtitulo]] as const) {
      if (txt && longestCommonRun(words(txt), ew) >= runLimit) out.push(f('copy_literal', `${label} copia trecho da fonte ${e.sourceId}`));
    }
    // título (parecer 70): contra o texto e contra o título da fonte, com o mesmo limite do corpo; igual ao título dela, com 4
    // palavras ou mais, também é cópia
    const hw = words(d.headline ?? '');
    const tw = words(e.title);
    if (Math.max(longestCommonRun(hw, ew), longestCommonRun(hw, tw)) >= runLimit || (hw.length >= 4 && hw.join(' ') === tw.join(' '))) {
      out.push(f('copy_literal', `titulo copia trecho da fonte ${e.sourceId}`));
    }
    const run = longestCommonRun(bw, ew);
    if (run >= runLimit) out.push(f('copy_literal', `${run} palavras consecutivas idênticas à fonte ${e.sourceId}`));
    const set = new Set<string>();
    for (let i = 0; i + 4 < ew.length; i++) set.add(ew.slice(i, i + 5).join(' '));
    let hit = 0; let tot = 0;
    for (let i = 0; i + 4 < bw.length; i++) { tot++; if (set.has(bw.slice(i, i + 5).join(' '))) hit++; }
    if (tot && hit / tot > ratioLimit) out.push(f('copy_literal', `${Math.round((hit / tot) * 100)}% dos 5-gramas coincidem com a fonte ${e.sourceId}`));
  }
  return result(out);
}

/** Atribuição: cada evidência usada precisa ter nome da fonte e link no corpo (gerado deterministicamente). */
export function buildAttribution(evidences: Evidence[], sources: Source[]): string {
  const lines = evidences.map((e) => {
    const s = sources.find((x) => x.id === e.sourceId);
    const name = attributionNameOf(e.sourceId) ?? s?.name ?? e.sourceId;
    return `- ${name}: ${e.canonicalUrl} (acessado em ${e.fetchedAt.slice(0, 10)})`;
  });
  return `Fontes:\n${lines.join('\n')}`;
}

export function checkAttribution(d: Draft, evidences: Evidence[]): CheckResult {
  const out: Finding[] = [];
  if (!d.evidenceIds.length) out.push(f('no_sources', 'matéria sem fontes'));
  for (const e of evidences.filter((x) => d.evidenceIds.includes(x.id))) {
    if (!d.body.includes(e.canonicalUrl)) out.push(f('missing_attribution', `link da fonte ausente: ${e.canonicalUrl}`));
  }
  // O bloco "Fontes:" é gerado pelo sistema e as demais checagens o ignoram: ele não pode carregar texto livre
  // (senão número/citação anexados depois dele escapariam do gate). Só linhas no formato exato e um único bloco.
  const parts = d.body.split(/\n\nFontes:\n/);
  if (parts.length !== 2) out.push(f('attribution_block', 'esperado exatamente um bloco "Fontes:" gerado pelo sistema'));
  else {
    for (const line of parts[1]!.split('\n')) {
      if (line.trim() === '') continue;
      if (!ATTRIBUTION_LINE.test(line)) out.push(f('tampered_attribution', 'bloco "Fontes:" contém texto fora do formato gerado'));
    }
  }
  return result(out);
}

const ATTRIBUTION_LINE = /^- .{1,300}: https?:\/\/\S+ \(acessado em \d{4}-\d{2}-\d{2}\)$/;

/** Evidência suspeita (instrução embutida) nunca sustenta matéria. */
export function checkEvidenceTrust(d: Draft, evidences: Evidence[]): CheckResult {
  const out: Finding[] = [];
  for (const e of evidences.filter((x) => d.evidenceIds.includes(x.id))) {
    if (e.suspicious) out.push(f('suspicious_evidence', `evidência ${e.id} marcada como suspeita: ${e.suspiciousReasons.join(',')}`));
  }
  return result(out);
}

// ---------- Imagem (D08): só com base de direito registrada; senão sem foto ----------

export function decideImage(source: Source, candidate: { url: string; credit: string; creditLink: string } | null): ImageDecision {
  if (!candidate) return { mode: 'none', reason: 'sem imagem candidata' };
  const b = source.imageRights;
  if (!b || !BASIS_KINDS.includes(b.kind) || !b.reference || !b.validatedBy) {
    return { mode: 'none', reason: 'sem base de direito de uso registrada para imagem da fonte; publicar sem foto' };
  }
  if (!candidate.credit || !candidate.creditLink) return { mode: 'none', reason: 'crédito/link da imagem ausentes; publicar sem foto' };
  return { mode: 'source_image', sourceId: source.id, url: candidate.url, credit: candidate.credit, creditLink: candidate.creditLink, basis: b };
}

/** Menção a IA/ferramenta/modelo: proibida em texto público da ilustração (D09). */
const TOOL_MENTION = /(\bIA\b|intelig[êe]ncia artificial|\bgerad[ao]s? (por|com|pelo|pela)\b|\bmodelo\b|\bdall|midjourney|\bgpt|openai|stable diffusion|\bflux\b|\bprompt\b)/i;

export function checkImage(img: ImageDecision): CheckResult {
  const out: Finding[] = [];
  if (img.mode === 'source_image') {
    if (!img.basis || !BASIS_KINDS.includes(img.basis.kind) || !img.basis.reference) out.push(f('rights_basis_unresolved', 'imagem sem base de direito registrada'));
    if (!img.credit || !img.creditLink) out.push(f('image_credit_missing', 'crédito e link obrigatórios'));
  }
  if (img.mode === 'conceptual') {
    // Ilustração gerada (ADR-018). Limites de uso sem detector automático ⇒ exigem REVISÃO HUMANA registrada:
    // nunca pessoa real reconhecível, logotipo/marca/produto/cartão real, cena documental, nem imagem de terceiro como referência.
    if (!/^https?:\/\/\S+$/i.test(img.url)) out.push(f('illustration_url_invalid', 'ilustração sem URL pública válida'));
    if (!img.alt.trim()) out.push(f('illustration_alt_missing', 'texto alternativo obrigatório'));
    if (TOOL_MENTION.test(img.alt)) out.push(f('illustration_mentions_tool', 'o texto alternativo não pode citar IA, modelo ou ferramenta (D09)'));
    if (!img.generatedBy.trim() || !img.promptVersion.trim() || !/^[0-9a-f]{64}$/.test(img.promptSha256)) out.push(f('illustration_registry_incomplete', 'registro interno incompleto (generatedBy, promptVersion, promptSha256)'));
    if (!img.humanReview?.limitsConfirmed || !img.humanReview.reviewedBy.trim()) {
      out.push(f('illustration_needs_human_review', 'revisão humana dos limites de uso pendente: sem pessoa real, marca/logotipo real, cena documental ou imagem de terceiro como referência'));
    }
  }
  return result(out);
}

/** Campos publicáveis (ADR-017 §4): resumo obrigatório ≤ 300, slug válido, classe pública, nunca patrocinado. */
export function checkPublishable(d: Draft): CheckResult {
  const out: Finding[] = [];
  if (typeof d.resumo !== 'string' || d.resumo.trim() === '') out.push(f('resumo_missing', 'resumo obrigatório para aprovar (até 300 caracteres)'));
  else if (d.resumo.length > RESUMO_MAX) out.push(f('resumo_too_long', `resumo com ${d.resumo.length} caracteres (máximo ${RESUMO_MAX})`));
  if (d.subtitulo !== undefined && d.subtitulo.length > RESUMO_MAX) out.push(f('subtitulo_too_long', `subtítulo acima de ${RESUMO_MAX} caracteres`));
  if (typeof d.slug !== 'string' || !SLUG_RE.test(d.slug) || d.slug.length > SLUG_MAX) out.push(f('slug_invalid', 'slug inválido (minúsculas, números e hífens)'));
  if (!ContentType.safeParse(d.tipoConteudo).success) out.push(f('content_type_invalid', 'tipo de conteúdo inválido'));
  if (d.classeDeDado !== 'public') out.push(f('data_class_not_public', 'matéria publicável precisa ser de classe pública'));
  if (d.patrocinado || d.tipoConteudo === 'patrocinado') out.push(f('sponsored_not_editorial', 'conteúdo patrocinado não nasce na fábrica editorial (é do módulo Comercial)'));
  if (d.image.mode === 'conceptual' && d.tipoConteudo === 'cobertura_evento') out.push(f('illustration_not_allowed_for_event', 'cobertura de evento não aceita ilustração (parece registro documental)'));
  if (d.rotuloPublieditorial !== undefined && d.patrocinado === false) out.push(f('label_without_sponsorship', 'rótulo publieditorial em conteúdo não patrocinado'));
  return result(out);
}

/**
 * Avisos publicados (ADR-019 §c.5): o bloco "Avisos:" do corpo precisa ser EXATAMENTE a lista de avisos registrados
 * (`expected`, em ordem). Aviso anterior removido ou alterado, aviso a mais ou bloco malformado reprovam. Sem avisos
 * registrados, o corpo não pode ter bloco "Avisos:".
 */
export function checkNotices(d: Draft, expected: readonly string[]): CheckResult {
  const out: Finding[] = [];
  const p = parseNotices(d.body);
  if (!p.ok) return result([f('notices_malformed', 'bloco "Avisos:" malformado ou duplicado')]);
  expected.forEach((t, i) => {
    if (p.notices[i] === undefined) out.push(f('notice_removed', `aviso #${i + 1} registrado não consta no corpo (avisos anteriores não podem sair)`));
    else if (p.notices[i] !== t) out.push(f('notice_altered', `aviso #${i + 1} difere do texto registrado`));
  });
  if (p.notices.length > expected.length) out.push(f('notice_unexpected', 'o corpo traz aviso que não foi registrado por um caso aceito'));
  return result(out);
}

// ---------- DP-29: âncora em fonte primária e conteúdo autoral ----------

/**
 * Blog e imprensa de nicho (fonte SECUNDÁRIA) são pista, não prova. Se qualquer evidência usada for secundária, a matéria
 * precisa de pelo menos uma evidência que ancore: PRIMÁRIA (RI, regulador, governo, associação, sala de imprensa) ou de um blog
 * autorizado por decisão (DP-59, `blog-anchor.ts`). Número e data precisam de evidência que ancore; citação entre aspas continua
 * exigindo evidência primária (não reproduzir).
 */
/** Trechos entre aspas (as mesmas que o gate de originalidade deixa de comparar, e « ») no título, resumo, subtítulo e corpo. */
function quotedParts(d: Draft): string[] {
  const text = [d.headline ?? '', d.resumo ?? '', d.subtitulo ?? '', mainBody(d.body ?? '')].join('\n\n');
  return [...text.matchAll(/["“]([^"”]*)["”]|«([^»]*)»/g)].map((m) => normalizeText(m[1] ?? m[2] ?? '')).filter(Boolean);
}

export function checkAnchoring(d: Draft, evidences: Evidence[]): CheckResult {
  const out: Finding[] = [];
  const byId = new Map(evidences.map((e) => [e.id, e]));
  const used = d.evidenceIds.map((i) => byId.get(i)).filter((e): e is Evidence => !!e);
  if (!used.some(isSecondary)) return result(out);
  // Nada entre aspas vindo de fonte secundária: usando blog, todo trecho entre aspas precisa constar numa evidência primária
  const primaryText = normalizeText(evidenceText(used.filter((e) => !isSecondary(e))));
  for (const quoted of quotedParts(d)) {
    if (!primaryText.includes(quoted)) out.push(f('quote_from_secondary', `trecho entre aspas sem fonte primária que o contenha (matéria usa fonte secundária): "${quoted.slice(0, 40)}"`));
  }
  // só o blog ancora: o nome dele precisa estar no texto
  if (!used.some((e) => !isSecondary(e))) {
    const body = ` ${normalizeText(mainBody(d.body ?? ''))} `;
    for (const e of used.filter((x) => isPermittedBlogAnchor(x))) {
      const name = BLOG_ANCHOR_ALLOWLIST.sources.find((x) => x.id === e.sourceId)!.name;
      if (!body.includes(` ${normalizeText(name)} `)) out.push(f('blog_attribution_missing', `matéria ancorada só em blog precisa atribuir no texto: "segundo o ${name}"`));
    }
  }
  const anchors = (e: Evidence): boolean => !isSecondary(e) || isPermittedBlogAnchor(e);
  if (!used.some(anchors)) out.push(f('needs_primary_anchor', 'matéria só com fonte secundária sem autorização para ancorar (blog/imprensa de nicho): falta evidência de fonte primária que confirme os fatos'));
  for (const c of d.claims) {
    if (c.kind === 'fact') continue;
    const evs = c.evidenceIds.map((i) => byId.get(i)).filter((e): e is Evidence => !!e);
    const holds = c.kind === 'quote' ? (e: Evidence) => !isSecondary(e) : anchors;
    if (evs.length && !evs.some(holds)) out.push(f('unanchored_claim', c.kind === 'quote' ? 'citação sustentada só por fonte secundária: precisa constar em fonte primária' : 'número ou data sustentado só por fonte secundária sem autorização para ancorar: precisa constar em fonte primária', c.id));
  }
  return result(out);
}

/** Aviso fixo do conteúdo autoral (a fábrica o põe no início do texto; o gate exige). */
export const AUTORAL_LABEL = 'Conteúdo autoral da Redação Loyalty News: análise feita a partir de fontes oficiais citadas ao final; não é recomendação de compra, investimento ou contratação.';
export const AUTORAL_MIN_PRIMARY = 2;

/**
 * Conteúdo autoral (pauta própria): ancorado em pelo menos 2 fontes primárias distintas, rotulado, sem falas
 * (não há entrevista), tipo 'analise'. As demais regras (números/datas nas evidências, sem apuração inventada, cópia) valem iguais.
 */
export function checkAutoral(d: Draft, evidences: Evidence[]): CheckResult {
  const out: Finding[] = [];
  if (!d.autoral) return result(out);
  const byId = new Map(evidences.map((e) => [e.id, e]));
  const used = d.evidenceIds.map((i) => byId.get(i)).filter((e): e is Evidence => !!e);
  const primaryUrls = new Set(used.filter((e) => !isSecondary(e)).map((e) => e.canonicalUrl));
  if (primaryUrls.size < AUTORAL_MIN_PRIMARY) out.push(f('autoral_needs_anchors', `conteúdo autoral exige ao menos ${AUTORAL_MIN_PRIMARY} páginas de fontes primárias distintas (há ${primaryUrls.size})`));
  if (!d.body.startsWith(AUTORAL_LABEL)) out.push(f('autoral_label_missing', 'conteúdo autoral precisa começar com o aviso de conteúdo autoral'));
  if (d.tipoConteudo !== 'analise') out.push(f('autoral_wrong_type', "conteúdo autoral é do tipo 'analise'"));
  if (d.claims.some((c) => c.kind === 'quote')) out.push(f('autoral_quote', 'conteúdo autoral não traz falas (não há entrevista nem apuração própria)'));
  return result(out);
}

export interface CheckOptions {
  /** Textos dos avisos já registrados na matéria (em ordem). */ notices?: readonly string[];
  /** Tom lint BLOQUEANTE (guia de tom v0.2). Padrão ligado; a correção de matéria JÁ publicada o desliga (não reprova texto antigo). */ tone?: boolean;
}

/** Bloqueios objetivos do guia de tom (emoji, "!" no título, título > 90, "veja/saiba/confira", frase do rodapé em inglês). Avisos: checkTone(d).warnings. */
export function checkToneBlocking(d: Draft): CheckResult { return result(checkTone(d).blocking); }

export function runDeterministicChecks(d: Draft, evidences: Evidence[], opts: CheckOptions = {}): CheckResult {
  const parts = [
    checkSignature(d), checkNoFabricatedReporting(d), checkEvidenceTrust(d, evidences), checkClaims(d, evidences),
    checkBodyGrounding(d, evidences), checkOriginality(d, evidences), checkAnchoring(d, evidences), checkAutoral(d, evidences), checkAttribution(d, evidences), checkImage(d.image), checkPublishable(d), checkNotices(d, opts.notices ?? []),
    ...(opts.tone === false ? [] : [checkToneBlocking(d)]),
  ];
  const findings = parts.flatMap((p) => p.findings);
  return result(findings);
}

export { checkTone } from './tone';
export type { Claim };
