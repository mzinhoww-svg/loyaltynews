import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DRYRUN_PAGES, SIM_CHECKER, SIM_DRAFTER } from '../../fixtures/piloto-dryrun.mock';
import { EXPECTED, runPilotoDryrun } from '../../fixtures/piloto-dryrun-run.mock';
import { renderDryrunMarkdown } from '../../fixtures/piloto-dryrun-report.mock';

// Ensaio do piloto em dry-run (Frente 06, [C] de 23/11): 5 fontes do checklist, 10 matérias simuladas, gates reais, sem rede e sem modelo.
const DATA = fileURLToPath(new URL('../../docs/piloto-dryrun.data.json', import.meta.url));
const MD = fileURLToPath(new URL('../../docs/piloto-dryrun.md', import.meta.url));

describe('ensaio do piloto em dry-run (simulado)', () => {
  it('10 matérias nas 5 fontes do checklist; cada uma faz o que o cenário prevê; nenhuma publicada; nenhuma chamada a modelo real', async () => {
    const r = await runPilotoDryrun();
    expect(r.fontes.map((f) => f.id).sort()).toEqual(['abemf', 'abrarec', 'camara-noticias', 'livelo-imprensa', 'senado-noticias']);
    expect(r.fontes.every((f) => f.coleta === 'collected' && f.evidencias === 2)).toBe(true);
    expect(r.materias).toHaveLength(10);
    expect(new Set(r.materias.map((m) => m.slot)).size).toBe(10);
    for (const m of r.materias) {
      expect(m.status, `${m.slot} ${m.cenario}: ${m.achados.join(' | ')}`).toBe(EXPECTED[m.cenario].status);
      expect(m.conforme, m.slot).toBe(true);
    }
    expect(r.resumo).toMatchObject({ total: 10, aprovadas: 5, bloqueadas: 5, conformes: 10, publicadas: 0 });
    expect(r.chamadasModeloReal).toBe(0);
    expect(r.chamadasSimuladas).toBeGreaterThan(0);
    // o "modelo" é roteirizado e marca SIMULADO: nenhum rascunho gravado pode ser publicado
    expect(r.resumo.recusadasPorSimulado).toBe(r.materias.filter((m) => m.publicacao !== 'sem rascunho').length);
    for (const m of r.materias) expect(m.publicacao === 'sem rascunho' || m.publicacao === 'recusada: simulated_content', m.slot).toBe(true);
  });

  it('gates: as 5 aprovadas passam nos 13 gates e na checagem independente; cada bloqueada é barrada pelo gate previsto', async () => {
    const r = await runPilotoDryrun();
    for (const m of r.materias.filter((x) => x.status === 'aprovado')) {
      expect(m.gates).toHaveLength(13);
      expect(m.gates!.filter((g) => g.verdict !== 'pass'), m.slot).toEqual([]);
      expect(m.checagem).toEqual({ provedor: SIM_CHECKER, independente: true });
      expect(m.linhasPiloto.filter((x) => x.gate_verdict === 'approved').map((x) => x.etapa)).toEqual(['draft', 'factcheck', 'review']);
    }
    const por = (c: string) => r.materias.find((m) => m.cenario === c)!;
    expect(por('copia_literal').gatesQueBarraram).toEqual(['copy_literal']);
    expect(por('copia_literal').achados.join(' ')).toMatch(/copy_literal: \d+ palavras consecutivas/);
    expect(por('numero_sem_fonte').achados.join(' ')).toMatch(/unsupported_metric: número "35"/);
    expect(por('tom_exclamacao').achados.join(' ')).toMatch(/tone_title_exclamation/);
    expect(por('checagem_reprova').linhasPiloto.find((x) => x.etapa === 'factcheck' && x.gate_verdict)).toMatchObject({ etapa: 'factcheck', gate_verdict: 'blocked' });
    expect(por('mesmo_provedor').bloqueios).toEqual(['cross_provider_check_failed']);
    expect(por('mesmo_provedor').checagem).toEqual({ provedor: SIM_DRAFTER, independente: false });
    expect(por('mesmo_provedor').linhasPiloto.find((x) => x.etapa === 'factcheck' && x.gate_verdict)).toMatchObject({ gate_verdict: 'blocked', cross_provider_ok: false });
    // redação barrada por gate (barreira determinística): UMA chamada de redação, sem nova tentativa e sem max_attempts
    for (const c of ['copia_literal', 'numero_sem_fonte', 'tom_exclamacao']) {
      expect(por(c).bloqueios).not.toContain('max_attempts');
      expect(por(c).estagios.filter((s) => s === 'draft'), c).toHaveLength(1);
    }
    // o gate da redação grava o veredito e os motivos na linha do piloto (achado 2)
    for (const c of ['copia_literal', 'numero_sem_fonte', 'tom_exclamacao']) {
      const g = por(c).linhasPiloto.find((x) => x.etapa === 'draft' && x.gate_verdict);
      expect(g, c).toMatchObject({ gate_verdict: 'blocked' });
      expect(g!.gate_reasons!.length, c).toBeGreaterThan(0);
    }
    expect(r.chamadasSimuladasPorClasse['draft']).toBe(10);
  });

  it('coletor: robots e prefixo do sitemap respeitados (as URLs plantadas nunca são requisitadas) e ≥ 3 s entre requisições ao mesmo host', async () => {
    const r = await runPilotoDryrun();
    expect(r.requisicoesProibidas).toEqual([]);
    expect(r.fontes.find((f) => f.id === 'senado-noticias')!.recusadas.map((k) => k.codigo)).toEqual(['robots_disallow']);
    for (const e of r.espacamento) { expect(e.menorIntervaloSeg, e.host).not.toBeNull(); expect(e.menorIntervaloSeg!, e.host).toBeGreaterThanOrEqual(3); }
  });

  it('o relatório versionado (docs/piloto-dryrun.md e .data.json) é o resultado deste ensaio (LN_WRITE_DRYRUN=1 regrava)', async () => {
    const r = await runPilotoDryrun();
    const json = `${JSON.stringify(r, null, 2)}\n`;
    const md = renderDryrunMarkdown(r);
    if (process.env['LN_WRITE_DRYRUN'] === '1') { writeFileSync(DATA, json); writeFileSync(MD, md); return; }
    expect(readFileSync(DATA, 'utf8').replace(/\r\n/g, '\n')).toBe(json);
    expect(readFileSync(MD, 'utf8').replace(/\r\n/g, '\n')).toBe(md);
  });

  it('o conteúdo do ensaio é fictício e marcado: todo rascunho leva SIMULADO e toda página se declara texto fictício', () => {
    for (const p of DRYRUN_PAGES) {
      expect(p.draft.headline + p.draft.body + p.draft.resumo, p.slot).toMatch(/\bSIMULADO\b/);
      expect(p.title, p.slot).toMatch(/^ENSAIO:/);
      expect(p.paragraphs[0], p.slot).toMatch(/FICTÍCIO/);
    }
  });
});
