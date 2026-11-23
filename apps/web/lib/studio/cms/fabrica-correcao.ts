// Correção de matéria PUBLICADA da Fábrica (ADR-019 §c.5): o mesmo `correcao` vai ao recibo (POST /api/materias/{id}/recibos) e à
// publicação oficial (POST /api/studio/editorial/articles/{id}/publication). Funções puras; quem valida de verdade é o Backend
// (zod estrito, caso aceito, gates, checagem de OUTRO provedor). Aqui só se monta o corpo e se evita mandar JSON quebrado.

export interface CorrecaoFabrica {
  casoId: string;
  draft: Record<string, unknown>;
  factcheck: Record<string, unknown>;
}

export type ResultadoCorrecao = { ok: true; correcao: CorrecaoFabrica } | { ok: false; erro: string };

function lerObjeto(rotulo: string, texto: string): { ok: true; valor: Record<string, unknown> } | { ok: false; erro: string } {
  if (!texto.trim()) return { ok: false, erro: `${rotulo}: informe o JSON.` };
  try {
    const v: unknown = JSON.parse(texto);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, erro: `${rotulo}: o JSON precisa ser um objeto.` };
    return { ok: true, valor: v as Record<string, unknown> };
  } catch (e) {
    return { ok: false, erro: `${rotulo}: JSON inválido (${e instanceof Error ? e.message : 'erro de leitura'}).` };
  }
}

/** Monta `{casoId, draft, factcheck}` a partir do formulário. O bloco "Avisos:" nunca vai no rascunho: o Backend o compõe. */
export function montarCorrecao(casoId: string, draftJson: string, factcheckJson: string): ResultadoCorrecao {
  if (!casoId.trim()) return { ok: false, erro: 'Escolha o caso de correção aceito.' };
  const draft = lerObjeto('Rascunho corrigido', draftJson);
  if (!draft.ok) return draft;
  const factcheck = lerObjeto('Checagem', factcheckJson);
  if (!factcheck.ok) return factcheck;
  return { ok: true, correcao: { casoId: casoId.trim(), draft: draft.valor, factcheck: factcheck.valor } };
}

/** Parte da leitura da revisão editorial (GET .../review) que serve de ponto de partida. */
export interface RevisaoFabrica {
  rascunho: {
    titulo: string;
    corpo: string;
    assinatura: string;
    imagem: unknown;
    claims: { id: string; kind: string; text: string; evidenceIds: string[] }[];
  } | null;
  evidencias: { id: string }[];
}
export interface MateriaFabrica {
  slug: string;
  editoria: string;
  subtitulo: string | null;
  resumo: string | null;
  tipoConteudo: string;
  patrocinado: boolean;
  rotuloPublieditorial: string | null;
}

/**
 * Ponto de partida do rascunho corrigido, só com o que as rotas de leitura expõem. Campos técnicos do rascunho da Fábrica que
 * nenhuma rota de leitura devolve (id do rascunho, provedor e prompt do modelo, classe de dado) vão VAZIOS: quem corrige os
 * preenche e o Backend recusa o que faltar. Nada é inventado.
 */
export function modeloDoRascunho(m: MateriaFabrica, r: RevisaoFabrica): Record<string, unknown> {
  const d = r.rascunho;
  return {
    id: '',
    editoria: m.editoria,
    headline: d?.titulo ?? '',
    ...(m.subtitulo ? { subtitulo: m.subtitulo } : {}),
    resumo: m.resumo ?? '',
    body: d?.corpo ?? '',
    slug: m.slug,
    tipoConteudo: m.tipoConteudo,
    classeDeDado: '',
    patrocinado: m.patrocinado,
    ...(m.patrocinado && m.rotuloPublieditorial ? { rotuloPublieditorial: m.rotuloPublieditorial } : {}),
    claims: (d?.claims ?? []).map((c) => ({ id: c.id, text: c.text, kind: c.kind, evidenceIds: c.evidenceIds })),
    evidenceIds: r.evidencias.map((e) => e.id),
    signature: d?.assinatura ?? '',
    image: d?.imagem ?? { mode: 'none', reason: '' },
    modelProvider: '',
    promptVersion: '',
  };
}

/** Modelo da checagem: um veredito por afirmação, sem preencher (a checagem é de OUTRO provedor, nunca do redator). */
export function modeloDaChecagem(claimIds: string[]): Record<string, unknown> {
  return { provider: '', model: '', verdicts: claimIds.map((claimId) => ({ claimId, verdict: '' })) };
}
