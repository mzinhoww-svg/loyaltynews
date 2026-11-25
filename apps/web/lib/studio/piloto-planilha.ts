// Exportação da planilha do piloto em CSV (Studio 2; decisão PM-2026-11-23-F). Função pura sobre:
//  - as linhas da trilha do piloto (uma por tarefa e tentativa; PilotRow do @ln/openbot, colunas PILOT_CSV_COLUMNS do AgentOps), e
//  - o mapa e as leituras da Editorial (GET /piloto e /piloto/:materia/leituras, que já aplicam a cegueira no servidor).
// Regras: as 31 colunas do AgentOps vêm primeiro, na mesma ordem e com o mesmo escape (fórmula neutralizada); colunas novas só no FIM.
// unsupported_* da linha FINAL da matéria (stage review ou check_edit) vêm da leitura do LEITOR 1 quando a linha ainda não os tem.
// Leitor 2: só sai quando o leitor 1 já registrou a dele naquela matéria (cegueira, PM-2026-11-23-C/E).
import { PILOT_CSV_COLUMNS } from '@ln/openbot';
import type { Leitura, MateriaPiloto } from './piloto-view';

export const COLUNAS_EXTRAS = ['materia', 'leitor1_veredito', 'leitor2_veredito', 'leitor2_unsupported_high', 'leitor2_unsupported_medium', 'leitor2_unsupported_low', 'leitor2_origem'] as const;
export const COLUNAS = [...PILOT_CSV_COLUMNS, ...COLUNAS_EXTRAS] as const;
const FINAIS = new Set(['review', 'check_edit']);

/** Mesmo escape do pilotCsv do @ln/openbot: fórmula de planilha neutralizada; aspas, vírgula e quebra entre aspas; lista com " | ". */
export function celula(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = Array.isArray(v) ? v.join(' | ') : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export type LinhaPiloto = Record<string, unknown> & { task_id: string; attempt: number; stage?: string; article_id?: string | null; started_at?: string };

/**
 * Fronteira da amostra medida: só as linhas que começaram depois do último `resume` auditado e que NÃO foram excluídas por
 * configuração. As demais continuam na planilha/trilha para auditoria, mas não entram no CSV que o avaliador lê.
 */
export function linhasDaAmostra<T extends LinhaPiloto & { tratada?: { acao?: string } }>(linhas: readonly T[], sampleStartedAt: string | null | undefined): T[] {
  const de = sampleStartedAt ? Date.parse(sampleStartedAt) : Number.NaN;
  return linhas.filter((r) => (Number.isNaN(de) || Date.parse(String(r.started_at)) >= de) && r.tratada?.acao !== 'config_invalid');
}

export function planilhaCsv(linhas: readonly LinhaPiloto[], materias: readonly MateriaPiloto[], leituras: Partial<Record<string, Leitura[]>>, sampleStartedAt?: string | null): string {
  const materiaDoArtigo = new Map(materias.filter((m) => m.articleId).map((m) => [m.articleId as string, m.materia]));
  const out = [COLUNAS.join(',')];
  for (const r of linhas) {
    const materia = r.article_id ? materiaDoArtigo.get(r.article_id) : undefined;
    const ls = materia ? (leituras[materia] ?? []) : [];
    const l1 = ls.find((l) => l.leitor === 1);
    const l2 = l1 ? ls.find((l) => l.leitor === 2) : undefined; // cegueira: sem a leitura do leitor 1, o leitor 2 não sai
    const linha: Record<string, unknown> = { ...r };
    if (l1 && FINAIS.has(String(r.stage)) && r.unsupported_facts === undefined) {
      Object.assign(linha, { unsupported_facts: l1.unsupportedFacts, unsupported_high: l1.altas, unsupported_medium: l1.medias, unsupported_low: l1.baixas });
    }
    Object.assign(linha, {
      materia: materia ?? '',
      leitor1_veredito: l1?.veredito ?? '',
      leitor2_veredito: l2?.veredito ?? '',
      leitor2_unsupported_high: l2?.altas,
      leitor2_unsupported_medium: l2?.medias,
      leitor2_unsupported_low: l2?.baixas,
      leitor2_origem: l2 ? (l2.origem === 'importacao' ? 'importacao' : 'studio') : '',
    });
    out.push(COLUNAS.map((c) => celula(linha[c])).join(','));
  }
  const de = sampleStartedAt
    ?? (linhas.length ? String([...linhas].map((r) => r.started_at).filter(Boolean).sort()[0] ?? new Date(0).toISOString()) : new Date(0).toISOString());
  return `# amostra_desde=${de}\n${out.join('\n')}\n`;
}
