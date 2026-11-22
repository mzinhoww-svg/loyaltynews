import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../db';
import {
  INFERRED_BADGE, LEGEND_DECLARED, LEGEND_INFERRED, addOrgChartEdge, addRole, layoutOrgChart, orgChartLayoutFor, renderOrgChartSvg, upsertOrganization,
  type OrgEdgeInput,
} from '../index';
import { ev, newDb, rp } from './helpers';

const e = (sup: string, sub: string, certainty: 'declared' | 'inferred' = 'declared', extra: Partial<OrgEdgeInput> = {}): OrgEdgeInput => ({
  superior_person_id: `p-${sup}`, superior_name: sup, superior_title: `Cargo ${sup}`,
  subordinate_person_id: `p-${sub}`, subordinate_name: sub, subordinate_title: `Cargo ${sub}`,
  certainty, ...extra,
});

// CEO -> (Dir A, Dir B); Dir A -> (Ger 1, Ger 2); Dir B -> Ger 3
const TREE: OrgEdgeInput[] = [e('CEO', 'Dir A'), e('CEO', 'Dir B'), e('Dir A', 'Ger 1'), e('Dir A', 'Ger 2'), e('Dir B', 'Ger 3')];

describe('layoutOrgChart: determinístico', () => {
  it('mesma entrada em qualquer ordem => mesma saída, byte a byte', () => {
    const a = JSON.stringify(layoutOrgChart(TREE));
    const b = JSON.stringify(layoutOrgChart([...TREE].reverse()));
    const c = JSON.stringify(layoutOrgChart([TREE[3]!, TREE[0]!, TREE[4]!, TREE[2]!, TREE[1]!]));
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(renderOrgChartSvg(layoutOrgChart(TREE))).toBe(renderOrgChartSvg(layoutOrgChart([...TREE].reverse())));
  });

  it('níveis, y por nível, pai centralizado sobre os filhos e nenhuma sobreposição', () => {
    const l = layoutOrgChart(TREE);
    const n = Object.fromEntries(l.nodes.map((x) => [x.name, x]));
    expect([n['CEO']!.level, n['Dir A']!.level, n['Ger 1']!.level]).toEqual([0, 1, 2]);
    expect(n['Dir A']!.y).toBeGreaterThan(n['CEO']!.y);
    expect(n['Dir A']!.x).toBe((n['Ger 1']!.x + n['Ger 2']!.x) / 2);
    expect(n['CEO']!.x).toBe((n['Dir A']!.x + n['Dir B']!.x) / 2);
    for (const a of l.nodes) for (const b of l.nodes) {
      if (a !== b && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(a.width);
    }
    expect(l.width).toBeGreaterThan(0);
    expect(l.nodes.every((x) => x.x >= 0 && x.y >= 0 && x.x + x.width <= l.width && x.y + x.height <= l.height)).toBe(true);
    expect(l.warnings).toEqual([]);
    expect(l.edges).toHaveLength(5);
    expect(l.edges.every((x) => x.points.length === 4 && x.style === 'solid' && x.badge === null)).toBe(true);
  });

  it('regra "inferida nunca como fato": tracejada, com selo e legenda; declarada contínua e sem selo', () => {
    const l = layoutOrgChart([e('CEO', 'Dir A'), e('CEO', 'Dir B', 'inferred', { inference_basis: 'mesma diretoria no site' })]);
    const decl = l.edges.find((x) => x.certainty === 'declared')!;
    const inf = l.edges.find((x) => x.certainty === 'inferred')!;
    expect([decl.style, decl.badge]).toEqual(['solid', null]);
    expect([inf.style, inf.badge, inf.label]).toEqual(['dashed', INFERRED_BADGE, INFERRED_BADGE.toLowerCase()]);
    expect(inf.label.startsWith('fato')).toBe(false);
    expect(inf.inference_basis).toBe('mesma diretoria no site');
    expect(l.nodes.find((x) => x.name === 'Dir B')!.has_inferred_link).toBe(true);
    expect(l.nodes.find((x) => x.name === 'Dir A')!.has_inferred_link).toBe(false);
    expect(l.legend.map((x) => x.text)).toEqual([LEGEND_DECLARED, LEGEND_INFERRED]);

    const svg = renderOrgChartSvg(l);
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(svg).toContain(INFERRED_BADGE);
    expect(svg).toContain(LEGEND_INFERRED);
  });

  it('só declarado: SVG sem selo, sem tracejado nas arestas e sem legenda de inferido', () => {
    const svg = renderOrgChartSvg(layoutOrgChart(TREE));
    expect(svg).not.toContain('INFERIDO');
    expect(svg).not.toContain('stroke-dasharray');
    expect(svg).not.toContain(LEGEND_INFERRED);
    expect(svg).toContain(LEGEND_DECLARED);
  });

  it('declarada vence inferida no mesmo par; pai da árvore prefere vínculo declarado; segundo superior vira conector extra', () => {
    const l = layoutOrgChart([e('A', 'X', 'inferred', { inference_basis: 'b' }), e('A', 'X'), e('A', 'Y'), e('B', 'X', 'inferred', { inference_basis: 'b' }), e('B', 'Z')]);
    expect(l.edges.filter((x) => x.from === 'p-A' && x.to === 'p-X')).toHaveLength(1);
    expect(l.edges.find((x) => x.from === 'p-A' && x.to === 'p-X')!.certainty).toBe('declared');
    const extra = l.edges.filter((x) => x.extra);
    expect(extra.map((x) => [x.from, x.to, x.certainty])).toEqual([['p-B', 'p-X', 'inferred']]);
  });

  it('ciclo: a aresta que fecha o ciclo é descartada com aviso, sem travar', () => {
    const l = layoutOrgChart([e('A', 'B'), e('B', 'C'), e('C', 'A')]);
    expect(l.warnings).toHaveLength(1);
    expect(l.warnings[0]!.code).toBe('cycle_edge_dropped');
    expect(l.edges).toHaveLength(2);
    expect(l.nodes).toHaveLength(3);
  });

  it('autoaresta ignorada; várias raízes lado a lado; entrada vazia', () => {
    expect(layoutOrgChart([e('A', 'A')]).empty).toBe(true);
    const l = layoutOrgChart([e('A', 'B'), e('C', 'D')]);
    const roots = l.nodes.filter((x) => x.level === 0);
    expect(roots).toHaveLength(2);
    expect(roots[0]!.x).not.toBe(roots[1]!.x);
    const empty = layoutOrgChart([]);
    expect(empty).toMatchObject({ empty: true, nodes: [], edges: [], width: 0, height: 0 });
    expect(renderOrgChartSvg(empty)).toContain('<svg');
  });

  it('SVG escapa texto, não tem script nem recurso externo e imprime MOCK quando pedido', () => {
    const l = layoutOrgChart([e('<script>alert(1)</script>', 'Ana & "Bia"')]);
    const svg = renderOrgChartSvg(l, { mock: true, title: 'Organograma <x>' });
    expect(svg).not.toContain('<script');
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('MOCK');
    expect(renderOrgChartSvg(l)).not.toContain('MOCK');
  });

  it('texto longo é abreviado no desenho, completo no <title>', () => {
    const l = layoutOrgChart([e('Fulano de Tal da Silva Sauro Pereira Gigante', 'B')]);
    const svg = renderOrgChartSvg(l, { maxChars: 12 });
    expect(svg).toContain('…');
    expect(svg).toContain('<title>Fulano de Tal da Silva Sauro Pereira Gigante — Cargo Fulano de Tal da Silva Sauro Pereira Gigante</title>');
  });
});

describe('orgChartLayoutFor: portal x Studio sobre o banco', () => {
  let db: Db;
  beforeEach(async () => { ({ db } = await newDb()); });

  async function seed() {
    const evi = await ev(db, 'chart');
    const t = '2026-11-01T00:00:00Z';
    const org = await upsertOrganization(db, { legalName: 'MOCK Alfa', evidenceId: evi, observedAt: t });
    const mk = async (n: string, title: string) => {
      const p = (await rp(db, { fullName: n, organizationId: org, evidenceId: evi, observedAt: t })).id;
      return addRole(db, { personId: p, organizationId: org, title, validFrom: '2025-01-01', evidenceId: evi, observedAt: t });
    };
    const ceo = await mk('MOCK Ceo', 'CEO'), dir = await mk('MOCK Dir', 'Diretor'), ger = await mk('MOCK Ger', 'Gerente');
    await addOrgChartEdge(db, { organizationId: org, superiorRoleId: ceo, subordinateRoleId: dir, validFrom: '2025-01-01', certainty: 'declared', evidenceId: evi, observedAt: t });
    await addOrgChartEdge(db, { organizationId: org, superiorRoleId: dir, subordinateRoleId: ger, validFrom: '2025-01-01', certainty: 'inferred', inferenceBasis: 'MOCK base', evidenceId: evi, observedAt: t });
    return org;
  }

  it('portal: só declarado, sem selo de inferido; Studio: com inferido tracejado e rotulado; ambos marcam MOCK', async () => {
    const org = await seed();
    const pub = await orgChartLayoutFor(db, org, 'public', '2026-11-22');
    expect(pub!.layout.edges.map((x) => x.certainty)).toEqual(['declared']);
    expect(pub!.inferred_edges).toBe(0);
    expect(pub!.svg).not.toContain('INFERIDO');
    expect(pub!.svg).toContain('MOCK');
    expect(pub!.has_mock).toBe(true);

    const studio = await orgChartLayoutFor(db, org, 'studio', '2026-11-22');
    expect(studio!.layout.edges).toHaveLength(2);
    expect(studio!.inferred_edges).toBe(1);
    expect(studio!.svg).toContain(INFERRED_BADGE);
    expect(studio!.svg).toContain('stroke-dasharray');
    expect(studio!.layout.legend).toHaveLength(2);
    expect(await orgChartLayoutFor(db, '00000000-0000-4000-8000-000000000000', 'public')).toBeNull();
  });

  it('empresa sem organograma: estado vazio honesto', async () => {
    const evi = await ev(db, 'x');
    const org = await upsertOrganization(db, { legalName: 'MOCK Vazia', evidenceId: evi, observedAt: '2026-11-01T00:00:00Z' });
    const r = await orgChartLayoutFor(db, org, 'public', '2026-11-22');
    expect(r!.layout.empty).toBe(true);
    expect(r!.svg).toContain('<svg');
  });
});
