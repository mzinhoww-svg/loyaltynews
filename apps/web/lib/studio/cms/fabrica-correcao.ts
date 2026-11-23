// Correção de matéria PUBLICADA da Fábrica (ADR-019 §c.5): o mesmo `correcao` vai ao recibo (POST /api/materias/{id}/recibos) e à
// publicação oficial (POST /api/studio/editorial/articles/{id}/publication). O rascunho completo e a última checagem vêm de
// GET /api/studio/editorial/articles/{id}/draft; a pessoa edita só o texto, e o resto do rascunho segue como o Backend o devolveu.
// Funções puras; quem valida de verdade é o Backend (zod estrito, caso aceito, gates, checagem de OUTRO provedor).

export type Veredito = 'pass' | 'fail' | 'inconclusive';
export const VEREDITOS: readonly Veredito[] = ['pass', 'fail', 'inconclusive'];

export interface AfirmacaoFabrica {
  id: string;
  kind: string;
  text: string;
  evidenceIds: string[];
  quote?: { text: string; speaker: string };
}
/** Rascunho devolvido pelo Backend: reenviado como está em `correcao.draft`, só com os campos de texto trocados. */
export interface DraftFabrica {
  id: string;
  headline: string;
  subtitulo?: string;
  resumo: string;
  body: string;
  claims: AfirmacaoFabrica[];
  [campo: string]: unknown;
}
export interface RascunhoFabrica {
  articleId: string;
  status: string;
  versaoPublicada: number | null;
  podeCorrigir: boolean;
  publicacao: { url: string; publicadoEm: string; corrigidoEm: string | null; contentSha256: string } | null;
  avisos: { caseId: string; tipo: string; em: string; texto: string }[];
  rascunho: DraftFabrica;
  checagem: { provider: string; model: string; verdicts: { claimId: string; verdict: string }[] } | null;
}

/** O que a pessoa digita. `verdicts[i]` é do claim `i` (mesma ordem de `claimTexts`). */
export interface EdicaoFabrica {
  casoId: string;
  headline: string;
  subtitulo: string;
  resumo: string;
  body: string;
  claimTexts: string[];
  provider: string;
  model: string;
  verdicts: string[];
}

export interface CorrecaoFabrica {
  casoId: string;
  draft: DraftFabrica;
  factcheck: { provider: string; model: string; verdicts: { claimId: string; verdict: Veredito }[] };
}
export type ResultadoCorrecao = { ok: true; correcao: CorrecaoFabrica } | { ok: false; erro: string };

/** Valores iniciais do formulário: o que o Backend devolveu. Veredito só é pré-preenchido se a última checagem o tem. */
export function edicaoInicial(r: RascunhoFabrica, casoId: string): EdicaoFabrica {
  const d = r.rascunho;
  const antes = new Map((r.checagem?.verdicts ?? []).map((v) => [v.claimId, v.verdict]));
  return {
    casoId,
    headline: d.headline,
    subtitulo: d.subtitulo ?? '',
    resumo: d.resumo,
    body: d.body,
    claimTexts: d.claims.map((c) => c.text),
    provider: r.checagem?.provider ?? '',
    model: r.checagem?.model ?? '',
    verdicts: d.claims.map((c) => antes.get(c.id) ?? ''),
  };
}

/** Monta `{casoId, draft, factcheck}`: o rascunho do Backend com o texto trocado e a checagem informada. O bloco "Avisos:" nunca vai: o Backend o compõe. */
export function montarCorrecao(base: RascunhoFabrica, e: EdicaoFabrica): ResultadoCorrecao {
  const d = base.rascunho;
  if (!e.casoId.trim()) return { ok: false, erro: 'Escolha o caso de correção aceito.' };
  if (!e.headline.trim()) return { ok: false, erro: 'Título: informe o título.' };
  if (!e.resumo.trim()) return { ok: false, erro: 'Resumo: informe o resumo.' };
  if (!e.body.trim()) return { ok: false, erro: 'Corpo: informe o corpo da matéria.' };
  if (/(^|\n)Avisos:/.test(e.body)) return { ok: false, erro: 'Corpo: tire o bloco “Avisos:”; o sistema o compõe a partir do caso.' };
  if (e.claimTexts.length !== d.claims.length) return { ok: false, erro: 'As afirmações mudaram desde que a tela abriu; recarregue.' };
  for (const [i, t] of e.claimTexts.entries()) if (!t.trim()) return { ok: false, erro: `Afirmação ${i + 1}: o texto não pode ficar vazio.` };
  if (!e.provider.trim() || !e.model.trim()) return { ok: false, erro: 'Checagem: informe provedor e modelo (de um provedor diferente do redator).' };
  const verdicts: { claimId: string; verdict: Veredito }[] = [];
  for (const [i, c] of d.claims.entries()) {
    const v = e.verdicts[i] ?? '';
    if (!(VEREDITOS as readonly string[]).includes(v)) return { ok: false, erro: `Checagem: escolha o veredito da afirmação ${i + 1}.` };
    verdicts.push({ claimId: c.id, verdict: v as Veredito });
  }
  const { subtitulo: _antigo, ...resto } = d;
  void _antigo;
  const draft: DraftFabrica = {
    ...resto,
    headline: e.headline.trim(),
    ...(e.subtitulo.trim() ? { subtitulo: e.subtitulo.trim() } : {}),
    resumo: e.resumo.trim(),
    body: e.body.trim(),
    claims: d.claims.map((c, i) => ({ ...c, text: e.claimTexts[i]!.trim() })),
  };
  return { ok: true, correcao: { casoId: e.casoId.trim(), draft, factcheck: { provider: e.provider.trim(), model: e.model.trim(), verdicts } } };
}

/** Afirmações cujo texto mudou: o veredito anterior não vale para o texto novo. */
export const afirmacoesAlteradas = (base: RascunhoFabrica, claimTexts: string[]): boolean[] => base.rascunho.claims.map((c, i) => (claimTexts[i] ?? '').trim() !== c.text.trim());
