import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SEED_SOURCES } from '../sources/seed';
import { eligibility } from '../sources/registry';

// Dossiê de habilitação das fontes do piloto (reconferido em 24/11/2026): o que o proprietário vai habilitar bate com o cadastro, e NADA está habilitado.
interface Fonte {
  id: string; nome: string; classe: 'A' | 'D'; enabled: boolean; limitePorHora: number; espacamentoSeg: number; rodadasPorDia: number;
  links: { listagem: string; entrada: string; tipoEntrada: 'feed' | 'sitemap'; robots: string; termos: string[] };
  conferencia: {
    data: string;
    robots: { status: number; caminhosPermitidos: boolean };
    entrada: { status: number; tipo: string; itens: number | null; urls: number | null; maisRecente: string | null };
    listagem: { status: number; titulo: string };
    termos: Array<{ tipo: string; url: string; status: number | null; trechosConferidos: Array<{ presente: boolean }> | null }>;
  };
  ressalvas: string[]; notaDeRevisao: string;
}
const doc = (n: string) => readFileSync(new URL(`../../docs/${n}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const data = JSON.parse(doc('dossie-habilitacao-piloto.data.json')) as { conferidoEm: string; fontes: Fonte[] };
const md = doc('dossie-habilitacao-piloto.md');
const termosDossie = doc('termos-fontes.md');
const seed = new Map(SEED_SOURCES.map((s) => [s.id, s]));
const IDS = ['senado-noticias', 'camara-noticias', 'abemf', 'livelo-imprensa', 'abrarec'];

describe('dossiê de habilitação do piloto (24/11/2026)', () => {
  it('são exatamente as 5 fontes do piloto (Senado, Câmara e 3 de classe D) e TODAS seguem desabilitadas, pendentes e inelegíveis no cadastro', () => {
    expect(data.fontes.map((f) => f.id)).toEqual(IDS);
    expect(data.fontes.filter((f) => f.classe === 'A').map((f) => f.id)).toEqual(['senado-noticias', 'camara-noticias']);
    expect(data.fontes.filter((f) => f.classe === 'D')).toHaveLength(3);
    for (const f of data.fontes) {
      const s = seed.get(f.id)!;
      expect(s, f.id).toBeTruthy();
      expect(f.enabled, `${f.id}: o dossiê declara desabilitada`).toBe(false);
      expect(s.enabled, `${f.id}: cadastro desabilitado`).toBe(false);
      expect(s.termsStatus, f.id).toBe('pending'); expect(s.urlVerified, f.id).toBe(false);
      expect(eligibility(s).ok, `${f.id}: sem revisão humana não é elegível para coleta`).toBe(false);
    }
  });

  it('endereços, limite por hora e espaçamento do dossiê são os do cadastro; classe confere com o dossiê de termos', () => {
    for (const f of data.fontes) {
      const s = seed.get(f.id)!;
      expect(f.links.listagem, `${f.id}: listagem`).toBe(s.listingUrl);
      expect(f.links.entrada, `${f.id}: feed/sitemap`).toBe(f.links.tipoEntrada === 'feed' ? s.feedUrl : s.sitemapUrl);
      expect(f.links.robots).toBe(`${new URL(s.listingUrl).origin}/robots.txt`);
      expect(f.limitePorHora, `${f.id}: limite por hora`).toBe(s.maxRequestsPerHour);
      expect(f.espacamentoSeg).toBeGreaterThanOrEqual(3); expect(f.rodadasPorDia).toBe(1);
      expect(f.links.termos.length).toBeGreaterThanOrEqual(1);
      for (const u of [f.links.listagem, f.links.entrada, f.links.robots, ...f.links.termos]) expect(u, `${f.id}: ${u}`).toMatch(/^https:\/\//);
      if (f.classe === 'A') expect(f.links.termos[0], `${f.id}: o termo da classe A é o termsUrl do cadastro`).toBe(s.termsUrl);
      expect(termosDossie, `${f.id}: classe ${f.classe} no dossiê de termos`).toMatch(new RegExp(`Classe ${f.classe} [^\\n]*fontes cadastradas: [^\\n]*\\b${f.id}\\b`));
    }
  });

  it('evidência de URL: conferência datada de 24/11/2026, tudo respondendo 200, caminhos permitidos pelo robots, termos abertos e trechos presentes', () => {
    expect(data.conferidoEm).toBe('2026-11-24');
    for (const f of data.fontes) {
      const c = f.conferencia;
      expect(c.data, f.id).toBe('2026-11-24');
      expect(c.robots, f.id).toMatchObject({ status: 200, caminhosPermitidos: true });
      expect(c.entrada.status, f.id).toBe(200); expect(c.entrada.tipo).toBe(f.links.tipoEntrada);
      expect((c.entrada.itens ?? c.entrada.urls ?? 0), `${f.id}: entrada com itens`).toBeGreaterThan(0);
      expect(c.entrada.maisRecente, f.id).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(c.listagem.status, f.id).toBe(200); expect(c.listagem.titulo.length).toBeGreaterThan(3);
      expect(c.termos.map((t) => t.url), `${f.id}: mesmos termos dos links`).toEqual(f.links.termos);
      for (const t of c.termos) {
        expect(t.status, `${f.id}: ${t.url}`).toBe(200);
        if (t.trechosConferidos) for (const q of t.trechosConferidos) expect(q.presente, `${f.id}: trecho presente`).toBe(true);
      }
      if (f.classe === 'A') expect(c.termos[0]!.trechosConferidos!.length, `${f.id}: classe A cita o termo lido`).toBeGreaterThanOrEqual(2);
    }
  });

  it('cada fonte tem nota de revisão pronta (≥ 20 caracteres, cita DP-28 e a reconferência) e ressalvas; o Livelo avisa do paywall "desconhecido" e a ABEMF do feed parado', () => {
    for (const f of data.fontes) {
      expect(f.notaDeRevisao.length, f.id).toBeGreaterThanOrEqual(20); expect(f.notaDeRevisao.length).toBeLessThanOrEqual(2000);
      expect(f.notaDeRevisao, f.id).toMatch(/DP-28/); expect(f.notaDeRevisao).toMatch(/Reconferido em 24\/11\/2026/);
      // a nota é colada como está num registro de auditoria: nada pendente dentro dela (N1 do QA 3)
      expect(f.notaDeRevisao, `${f.id}: sem pendência na nota`).not.toMatch(/\(conferir\)|\bTODO\b|PREENCHER|\?\?\?/);
      expect(f.ressalvas.length, f.id).toBeGreaterThanOrEqual(1);
    }
    const por = (id: string) => data.fontes.find((f) => f.id === id)!;
    expect(seed.get('livelo-imprensa')!.paywall).toBe('unknown');
    expect(por('livelo-imprensa').ressalvas.join(' ')).toMatch(/paywall/);
    expect(por('abemf').conferencia.entrada.maisRecente! < '2026-11-01').toBe(true);
    expect(por('abemf').ressalvas.join(' ')).toMatch(/parado/);
  });

  it('o texto do dossiê traz, por fonte, links, resultado da conferência, nota para colar e o texto de decisão pronto para o PM; e diz que nada foi habilitado', () => {
    for (const f of data.fontes) {
      expect(md, f.id).toContain(`\`${f.id}\``);
      for (const u of [f.links.listagem, f.links.entrada, f.links.robots, ...f.links.termos]) expect(md, `${f.id}: ${u}`).toContain(u);
      expect(md, `${f.id}: nota para colar`).toContain(f.notaDeRevisao);
      expect(md, `${f.id}: limite`).toContain(`${f.limitePorHora}/h · ${f.espacamentoSeg} s`);
      const e = f.conferencia.entrada;
      expect(md, `${f.id}: entrada conferida`).toContain(`${e.tipo} ${e.status}, ${e.itens ?? e.urls} ${e.itens ? 'itens' : 'URLs'}`);
    }
    expect(md).toContain('Reconferido em 24/11/2026'); expect(md).toContain('reconferido em 24/11/2026');
    expect(md).toMatch(/Nenhuma fonte foi habilitada/); expect(md).toMatch(/`enabled: false`/);
    expect(md).toMatch(/## Decisão pedida ao proprietário \(texto pronto para o PM\)/);
    expect(md).toMatch(/autoriza habilitar as 5 fontes do piloto/);
    expect(md).toMatch(/não há autorização do titular/);
    expect(md).toMatch(/Crawl-delay: 10[^\n]*bingbot, msnbot e Slurp/);
    expect(md).toMatch(/Nenhuma matéria foi coletada, nada foi habilitado e não houve custo/);
  });
});
