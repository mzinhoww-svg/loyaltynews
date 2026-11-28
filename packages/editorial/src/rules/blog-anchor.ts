import type { Evidence } from '../types';

/**
 * DP-59 (proprietário, 25/11/2026; confirmada pela DP-103 em 28/11): estes blogs de milhas podem ser a âncora principal de uma
 * matéria. Continuam obrigatórios: checagem por provedor diferente do redator, revisão independente, link, correção pública e não
 * reproduzir (DP-29, limite de cópia de fonte secundária). Citação entre aspas continua pedindo fonte primária.
 * Outro blog só entra por nova decisão registrada e commit revisado nesta lista. A entrada em decisions.yaml segue o 5º ato.
 */
export interface BlogAnchorList { decisionId: string; decidedOn: string; sources: ReadonlyArray<{ id: string; host: string; name: string }> }

export const BLOG_ANCHOR_ALLOWLIST: BlogAnchorList = Object.freeze({
  decisionId: 'DP-59',
  decidedOn: '2026-11-25',
  sources: Object.freeze([
    Object.freeze({ id: 'passageiro-de-primeira', host: 'passageirodeprimeira.com', name: 'Passageiro de Primeira' }),
    Object.freeze({ id: 'mestre-das-milhas', host: 'mestredasmilhas.com', name: 'Mestre das Milhas' }),
  ]),
});

const hostOf = (url: string): string | null => {
  try { const u = new URL(url); return u.protocol === 'https:' ? u.hostname : null; } catch { return null; }
};

/**
 * A evidência vale como âncora de blog quando: é de fonte secundária da lista, o endereço lido E o canônico são do host dela, foi lida
 * pelo próprio coletor (nunca por provedor de leitura) e não tem instrução embutida. Na dúvida, não vale.
 */
export function isPermittedBlogAnchor(e: Evidence, list: BlogAnchorList = BLOG_ANCHOR_ALLOWLIST): boolean {
  if (e.sourceTier !== 'secondary' || e.suspicious || e.acesso === 'via-provedor') return false;
  const entry = list.sources.find((s) => s.id === e.sourceId);
  return !!entry && hostOf(e.url) === entry.host && hostOf(e.canonicalUrl) === entry.host;
}
