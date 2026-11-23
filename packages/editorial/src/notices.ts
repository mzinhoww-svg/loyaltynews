/**
 * Bloco "Avisos:" do corpo da matéria (errata e direito de resposta publicados), ADR-019 §c.5.
 * Fica ENTRE o texto e o bloco "Fontes:", é gerado pelo sistema (nunca pelo modelo) e entra no hash do recibo.
 * Formato: cada aviso começa em "- "; as demais linhas do aviso (texto do requerente é multilinha) levam 2 espaços de recuo.
 */

export const NOTICES_MARK = '\n\nAvisos:\n';
export const FONTES_MARK = '\n\nFontes:\n';

export function renderNotices(texts: readonly string[]): string {
  if (!texts.length) return '';
  return NOTICES_MARK + texts.map((t) => `- ${t.split('\n').join('\n  ')}`).join('\n');
}

export type ParsedNotices = { ok: true; notices: string[] } | { ok: false };

/** Lê o bloco de avisos do corpo. Sem bloco => lista vazia. Formato inválido ou mais de um bloco => ok:false. */
export function parseNotices(body: string): ParsedNotices {
  const first = body.indexOf(NOTICES_MARK);
  if (first < 0) return { ok: true, notices: [] };
  if (body.indexOf(NOTICES_MARK, first + 1) >= 0) return { ok: false };
  const start = first + NOTICES_MARK.length;
  const end = body.indexOf(FONTES_MARK, start);
  if (end < 0) return { ok: false };
  const out: string[] = [];
  for (const line of body.slice(start, end).split('\n')) {
    if (line.startsWith('- ')) out.push(line.slice(2));
    else if (line.startsWith('  ') && out.length) out[out.length - 1] += `\n${line.slice(2)}`;
    else return { ok: false };
  }
  return out.length ? { ok: true, notices: out } : { ok: false };
}

/** Monta o corpo final: texto + avisos + Fontes (o texto não pode trazer avisos nem Fontes). */
export function composeBody(main: string, notices: readonly string[], fontesBlock: string): string {
  return `${main}${renderNotices(notices)}${FONTES_MARK}${fontesBlock}`;
}

/** Parte do corpo depois de "Fontes:" (sem o marcador), ou '' se não houver. */
export function fontesPart(body: string): string {
  const i = body.indexOf(FONTES_MARK);
  return i < 0 ? '' : body.slice(i + FONTES_MARK.length);
}
