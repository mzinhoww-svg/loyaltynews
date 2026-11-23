import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import { DEFAULT_REREAD_CONFIG, currentHolder, listMoves, loadSeed, rereadSourcesFromSeed, runRereadCycle, type PageReader, type RereadSource, type SeedDataset, type VerificationReport } from '../index';
import { newDb } from './helpers';

const file = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const read = <T>(n: string): T => JSON.parse(readFileSync(file(n), 'utf8')) as T;
const V5 = read<SeedDataset>('seed.public.v5.json');
const V5_VER = read<VerificationReport>('seed.public.v5.verification.json');
const ON = { personIngestion: true, extendedPersonalData: false };
const CONF = { enabled: true };
const FILLER = ' Governança corporativa, relações com investidores, composição da administração e comitês de assessoramento.'.repeat(12);

let db: Db;
let sources: RereadSource[];
beforeEach(async () => {
  ({ db } = await newDb());
  sources = rereadSourcesFromSeed(V5);
});
const src = (id: string) => sources.find((s) => s.id === id)!;
/** Página sintética: o cabeçalho de tabela + as citações conhecidas da fonte (+ ajustes) + texto de enchimento. */
const pageOf = (s: RereadSource, tweak: (t: string) => string = (t) => t) => tweak(`Membros Cargo ${s.roles.map((r) => r.quote).join(' ')}${FILLER}`);
const readerOf = (map: Record<string, string>): PageReader => async (url) => (url in map ? { ok: true, text: map[url], finalUrl: url } : { ok: false, failure: 'sem texto' });
const count = async (t: string) => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.${t}`)).rows[0]!.c);
const NOW = () => new Date('2027-03-01T10:00:00Z');

describe('releitura agendada das páginas oficiais', () => {
  it('desligada por padrão e sem a ingestão de pessoas: não lê nada', async () => {
    let calls = 0;
    const read: PageReader = async () => { calls++; return { ok: false }; };
    expect(DEFAULT_REREAD_CONFIG.enabled).toBe(false);
    expect(await runRereadCycle(db, sources, { read, cfg: ON })).toMatchObject({ ran: false, skipped: 'disabled' });
    expect(await runRereadCycle(db, sources, { read, cfg: { personIngestion: false, extendedPersonalData: false }, config: CONF })).toMatchObject({ ran: false, skipped: 'person_ingestion_disabled' });
    expect(calls).toBe(0);
  });

  it('fontes do job = páginas oficiais dos cargos do conjunto (32 cargos, 17 organizações); nenhuma de LinkedIn/The Org', () => {
    expect(sources.flatMap((s) => s.roles)).toHaveLength(32);
    expect(new Set(sources.flatMap((s) => s.roles.map((r) => r.orgName))).size).toBe(17);
    for (const s of sources) expect(s.url).not.toMatch(/linkedin|theorg/i);
    // só cargo único com citação "Nome<sep>Cargo" vale para troca de titular; vice, conselho e frase solta não
    const ex = sources.flatMap((s) => s.roles).filter((r) => r.exclusive).map((r) => r.title);
    expect(ex).toContain('Diretor Presidente');
    expect(sources.flatMap((s) => s.roles).find((r) => r.title.includes('Conselho'))!.exclusive).toBe(false);
    expect(src('livelo-imp').roles[0]!.exclusive).toBe(false); // "afirma André Fehlauer, CEO da Livelo": frase de release, não tabela
  });

  it('página igual: revalida (sem Move) e na rodada seguinte a página não está vencida', async () => {
    await loadSeed(db, V5, V5_VER, ON);
    const reader = readerOf(Object.fromEntries(sources.map((s) => [s.url, pageOf(s)])));
    const first = await runRereadCycle(db, sources, { read: reader, cfg: ON, config: { enabled: true, maxPagesPerCycle: 50 }, now: NOW });
    expect(first.ran).toBe(true);
    expect(first.moves).toBe(0);
    expect(first.pages.every((p) => p.status === 'unchanged' && p.found === p.known)).toBe(true);
    expect(await count('move')).toBe(0);
    const v = (await db.query<{ validated_at: string }>(`SELECT validated_at FROM intelligence.role_assignment LIMIT 1`)).rows[0]!;
    expect(new Date(v.validated_at).toISOString()).toBe('2027-03-01T10:00:00.000Z');
    const again = await runRereadCycle(db, sources, { read: reader, cfg: ON, config: { enabled: true, maxPagesPerCycle: 50 }, now: () => new Date('2027-03-02T10:00:00Z') });
    expect(again.pages.every((p) => p.status === 'not_due')).toBe(true); // intervalo de 7 dias
  });

  it('cargo único com outro titular na página: saída do antigo vira Move DETECTADO (revisão humana); o novo entra como linha de base', async () => {
    await loadSeed(db, V5, V5_VER, ON);
    const bv = src('bv-diretoria');
    const reader = readerOf({ [bv.url]: pageOf(bv, (t) => t.replace('Gustavo Henrique Santos de Sousa Diretor Presidente', 'Maria Clara Souza Diretor Presidente')) });
    const r = await runRereadCycle(db, [bv], { read: reader, cfg: ON, config: CONF, now: NOW });
    expect(r.moves).toBe(1);
    expect(r.pages[0]).toMatchObject({ status: 'changed', moves: 1 });
    const [m] = await listMoves(db);
    expect(m).toMatchObject({ kind: 'departure', status: 'detected', basis: 'observed_diff' });
    const roles = await db.query<{ full_name: string; valid_to: string | null }>(
      `SELECT p.full_name, r.valid_to::text FROM intelligence.role_assignment r JOIN intelligence.person p ON p.id = r.person_id JOIN intelligence.organization o ON o.id = r.organization_id
        WHERE o.legal_name = 'Banco BV' ORDER BY p.full_name`);
    expect(roles.rows).toEqual([{ full_name: 'Gustavo Henrique Santos de Sousa', valid_to: '2027-03-01' }, { full_name: 'Maria Clara Souza', valid_to: null }]);
  });

  it('ausência não é saída: vice que sumiu da página só vai para revisão; nenhum cargo é fechado', async () => {
    await loadSeed(db, V5, V5_VER, ON);
    const bb = src('bb-diretor');
    const reader = readerOf({ [bb.url]: pageOf(bb, (t) => t.replace('Ana Cristina Rosa Garcia VICE-PRESIDENTE CORPORATIVO', '')) });
    const r = await runRereadCycle(db, [bb], { read: reader, cfg: ON, config: CONF, now: NOW });
    expect(r.pages[0]).toMatchObject({ status: 'review', found: 2, missing: 1, moves: 0 });
    expect(r.pages[0]!.reasons![0]).toMatch(/citação não encontrada/);
    expect(await count('move')).toBe(0);
    expect((await db.query(`SELECT 1 FROM intelligence.role_assignment WHERE valid_to IS NOT NULL`)).rows).toHaveLength(0);
  });

  it('página suspeita ou leitura que falhou: nenhuma alteração', async () => {
    await loadSeed(db, V5, V5_VER, ON);
    const gpa = src('gpa-adm');
    const cases: [string, PageReader][] = [
      ['curta', async () => ({ ok: true, text: 'Acesso negado', finalUrl: gpa.url })],
      ['outro host', async () => ({ ok: true, text: pageOf(gpa), finalUrl: 'https://outro.example/pagina' })],
      ['quase nada conhecido', async () => ({ ok: true, text: `Diretoria sem relação com o cadastro.${FILLER}`, finalUrl: gpa.url })],
      ['falha', async () => ({ ok: false, failure: 'timeout' })],
      ['exceção', async () => { throw new Error('rede'); }],
    ];
    for (const [nome, read] of cases) {
      const r = await runRereadCycle(db, [gpa], { read, cfg: ON, config: CONF, now: NOW });
      expect(['page_suspect', 'read_failed'], nome).toContain(r.pages[0]!.status);
      expect(r.moves, nome).toBe(0);
    }
    expect(await count('move')).toBe(0);
    expect((await db.query(`SELECT 1 FROM intelligence.role_assignment WHERE valid_to IS NOT NULL`)).rows).toHaveLength(0);
  });

  it('ritmo baixo: respeita o teto de páginas por ciclo', async () => {
    await loadSeed(db, V5, V5_VER, ON);
    const reader = readerOf(Object.fromEntries(sources.map((s) => [s.url, pageOf(s)])));
    const r = await runRereadCycle(db, sources, { read: reader, cfg: ON, config: { enabled: true, maxPagesPerCycle: 3 }, now: NOW });
    expect(r.pages.filter((p) => p.status !== 'not_due')).toHaveLength(3);
    expect(r.pages.filter((p) => p.reasons?.includes('teto de páginas do ciclo')).length).toBe(sources.length - 3);
  });

  it('o presidente do Conselho (cargo com o órgão no título) não vira title_change ao reler a página', async () => {
    await loadSeed(db, V5, V5_VER, ON);
    const rd = src('rd-governanca');
    const r = await runRereadCycle(db, [rd], { read: readerOf({ [rd.url]: pageOf(rd) }), cfg: ON, config: CONF, now: NOW });
    expect(r.pages[0]).toMatchObject({ status: 'unchanged', found: 1 });
    expect(await count('move')).toBe(0);
    expect(await count('role_assignment')).toBe(32);
  });
});

describe('currentHolder (titular do cargo único na página)', () => {
  it('lê o nome logo antes do cargo, ignora cabeçalho de tabela e respeita o separador', () => {
    expect(currentHolder('Membros Cargo Marcelo de Araújo Noronha Diretor-Presidente CEO do Banco', 'Diretor-Presidente')).toBe('Marcelo de Araújo Noronha');
    expect(currentHolder('Diretoria Ney Ferraz Dias | Diretor-Presidente Bradesco Seguros', 'Diretor-Presidente', ' | ')).toBe('Ney Ferraz Dias');
    expect(currentHolder('Nome Cargo Início Gustavo Sousa Diretor Presidente Até 2027', 'Diretor Presidente')).toBe('Gustavo Sousa');
    expect(currentHolder('Marcílio D&rsquo;Amico Pousada Presidente', 'Presidente')).toBe('Marcílio D’Amico Pousada');
  });
  it('honorífico não faz parte do nome: "Dr. João Silva" e "João Silva" são o mesmo titular (sem falsa saída)', () => {
    expect(currentHolder('Membros Cargo Dr. Marcelo de Araújo Noronha Diretor-Presidente', 'Diretor-Presidente')).toBe('Marcelo de Araújo Noronha');
    expect(currentHolder('Sra. Ana Paula Teixeira | Diretora', 'Diretora', ' | ')).toBe('Ana Paula Teixeira');
    expect(currentHolder('Prof. Dr. Gustavo Sousa Diretor Presidente', 'Diretor Presidente')).toBe('Gustavo Sousa');
    expect(currentHolder('Dr. Diretor-Presidente', 'Diretor-Presidente')).toBeNull();
  });
  it('devolve null quando o que vem antes não parece nome (menu, minúsculas, uma palavra) ou o separador é outro', () => {
    expect(currentHolder('Conselho de Administração Presidente', 'Presidente')).toBeNull();
    expect(currentHolder('o diretor presidente da companhia', 'presidente')).toBeNull();
    expect(currentHolder('Governança Diretor-Presidente', 'Diretor-Presidente')).toBeNull();
    expect(currentHolder('Ney Ferraz Dias Diretor-Presidente', 'Diretor-Presidente', ' | ')).toBeNull();
  });
});
