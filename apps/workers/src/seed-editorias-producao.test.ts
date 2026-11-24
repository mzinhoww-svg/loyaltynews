import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EDITORIAS } from '@ln/contracts';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import { CONFIRM_FLAG, SeedEditoriasRefused, assertProduction, assertProductionBound, run, seedEditoriasProducao } from './seed-editorias-producao';
import bindingsReal from '../../../infra/vertra/bindings.json';
import type { BindingsFile } from './staging-admin';

const DB = 'postgres://app:SENHA-DO-BANCO@prod-db.vertra.invalid:5432/ln_prod';
const PROD = { APP_ENV: 'production', DATABASE_URL: DB };
const BINDINGS: BindingsFile = { ambientes: { staging: { dbHost: 'stg.vertra.invalid', dbName: 'ln_stg' }, production: { dbHost: 'prod-db.vertra.invalid', dbName: 'ln_prod' } } };
const SEM_PROD: BindingsFile = { ambientes: { staging: { dbHost: 'stg.vertra.invalid', dbName: 'ln_stg' }, production: { dbHost: null, dbName: null } } };

const exec = async (argv: string[], env: Record<string, string | undefined>, db: unknown, bindings: BindingsFile = BINDINGS) => {
  const out: string[] = [];
  const code = await run(argv, env, (s) => out.push(s), { db, bindings });
  return { code, text: out.join('\n') };
};

describe('seed-editorias-producao: barreiras (nada é gravado)', () => {
  it('sem --confirm-production (ou com argumento a mais) recusa com 2', async () => {
    const t = await createTestDb();
    try {
      for (const argv of [[], ['--confirm'], [CONFIRM_FLAG, '--outro'], ['--confirm-production=1'], ['apply']]) {
        const r = await exec(argv, PROD, t.db);
        expect(r.code, argv.join(' ')).toBe(2);
        expect(r.text).toMatch(/^uso: seed-editorias-producao --confirm-production/);
      }
      expect(await t.db.select().from(schema.editorias)).toHaveLength(0);
      expect(await t.db.select().from(schema.auditLog)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it('APP_ENV diferente de production (staging, producao, Production, vazio, ausente) recusa', async () => {
    const t = await createTestDb();
    try {
      for (const APP_ENV of ['staging', 'producao', 'Production', ' production', '', 'dev']) {
        const r = await exec([CONFIRM_FLAG], { APP_ENV, DATABASE_URL: DB }, t.db);
        expect(r.code, APP_ENV).toBe(2);
        expect(r.text).toMatch(/só vale com APP_ENV=production/);
      }
      expect((await exec([CONFIRM_FLAG], { DATABASE_URL: DB }, t.db)).code).toBe(2);
      expect(() => assertProduction({ APP_ENV: 'staging' })).toThrow(SeedEditoriasRefused);
      expect(await t.db.select().from(schema.editorias)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it('banco que não é o de produção registrado (outro host, outro nome, staging, inválida, ausente) recusa SEM repetir URL, host ou banco', async () => {
    const t = await createTestDb();
    try {
      for (const url of [
        'postgres://app:SENHA-STG@stg.vertra.invalid:5432/ln_stg', // o de staging
        'postgres://app:SENHA-X@prod-db.vertra.invalid:5432/ln_stg', // host certo, banco errado
        'postgres://app:SENHA-Y@outro.vertra.invalid:5432/ln_prod', // banco certo, host errado
        'mysql://app:SENHA-Z@prod-db.vertra.invalid/ln_prod',
        'isto-nao-e-url',
        '',
      ]) {
        const r = await exec([CONFIRM_FLAG], { APP_ENV: 'production', DATABASE_URL: url }, t.db);
        expect(r.code, url).toBe(2);
        expect(r.text).not.toMatch(/SENHA|@|ln_prod|ln_stg|vertra\.invalid/);
      }
      expect((await exec([CONFIRM_FLAG], { APP_ENV: 'production' }, t.db)).code).toBe(2); // sem DATABASE_URL
      expect(() => assertProductionBound(DB, BINDINGS)).not.toThrow();
      expect(() => assertProductionBound('postgres://u:p@PROD-DB.vertra.invalid/ln_prod', BINDINGS)).not.toThrow(); // host sem diferença de caixa
      expect(await t.db.select().from(schema.editorias)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it('produção sem vínculo em bindings.json (nulos) recusa', async () => {
    const t = await createTestDb();
    try {
      const r = await exec([CONFIRM_FLAG], PROD, t.db, SEM_PROD);
      expect(r.code).toBe(2);
      expect(r.text).toMatch(/sem vínculo de banco/);
      expect(await t.db.select().from(schema.editorias)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it('o bindings.json REAL (o da produção registrada) aceita o banco dele e recusa o de staging (URL SEM credencial: só host e banco contam)', () => {
    const prod = (bindingsReal as BindingsFile).ambientes.production;
    const stg = (bindingsReal as BindingsFile).ambientes.staging;
    expect(prod.dbHost && prod.dbName, 'produção precisa estar registrada').toBeTruthy();
    expect(() => assertProductionBound(`postgres://${prod.dbHost}:5432/${prod.dbName}`)).not.toThrow();
    if (stg.dbHost && (stg.dbHost !== prod.dbHost || stg.dbName !== prod.dbName)) expect(() => assertProductionBound(`postgres://${stg.dbHost}:5432/${stg.dbName}`)).toThrow(/NÃO aponta/);
  });
});

describe('seed-editorias-producao: efeito', () => {
  it('cria exatamente as 10 editorias oficiais, imprime só "editorias criadas: 10, já existiam: 0" e audita uma vez (só contagens)', async () => {
    const t = await createTestDb();
    try {
      const r = await exec([CONFIRM_FLAG], PROD, t.db);
      expect(r).toEqual({ code: 0, text: 'editorias criadas: 10, já existiam: 0' });
      const rows = await t.db.select().from(schema.editorias);
      expect(rows.map((e) => e.slug).sort()).toEqual(EDITORIAS.map((e) => e.slug).sort());
      expect(rows).toHaveLength(10);
      for (const e of EDITORIAS) expect(rows.find((x) => x.slug === e.slug)?.nome).toBe(e.nome);
      const trilha = await t.db.select().from(schema.auditLog);
      expect(trilha).toHaveLength(1);
      expect(trilha[0]).toMatchObject({ action: 'producao.editorias_seed', resource: 'editorias', actorId: 'seed-editorias-producao' });
      expect(trilha[0]!.detalhe).toEqual({ criadas: 10, existiam: 0 });
      expect(JSON.stringify(trilha)).not.toMatch(/SENHA|postgres:/);
    } finally {
      await t.close();
    }
  });

  it('é idempotente: repetir não duplica nem altera ("criadas: 0, já existiam: 10"); editoria pré-existente com outro nome NÃO é sobrescrita', async () => {
    const t = await createTestDb();
    try {
      await t.db.insert(schema.editorias).values({ slug: 'mercado', nome: 'Nome já em uso' });
      const a = await exec([CONFIRM_FLAG], PROD, t.db);
      expect(a.text).toBe('editorias criadas: 9, já existiam: 1');
      const b = await exec([CONFIRM_FLAG], PROD, t.db);
      expect(b).toEqual({ code: 0, text: 'editorias criadas: 0, já existiam: 10' });
      const rows = await t.db.select().from(schema.editorias);
      expect(rows).toHaveLength(10);
      expect(rows.find((e) => e.slug === 'mercado')?.nome).toBe('Nome já em uso');
    } finally {
      await t.close();
    }
  });

  it('SÓ editorias: nenhuma matéria, evento, documento de site, usuário ou fonte nasce', async () => {
    const t = await createTestDb();
    try {
      await seedEditoriasProducao(t.db as unknown as Db);
      for (const tabela of ['articles', 'agenda_events', 'site_documentos', 'auth_user', 'sources', 'article_sources', 'evidences']) {
        const n = (await t.client.query<{ n: number }>(`SELECT count(*)::int n FROM ${tabela}`)).rows[0]!.n;
        expect(n, tabela).toBe(0);
      }
    } finally {
      await t.close();
    }
  });

  it('exatamente as 10 slugs oficiais do Blueprint', () => {
    expect(EDITORIAS.map((e) => e.slug)).toEqual(['mercado', 'programas', 'pontos', 'bancos', 'varejo', 'travel', 'tech', 'crm', 'global', 'regulacao']);
  });

  it('o código-fonte não imprime URL/segredo e só escreve em editorias e audit_log', () => {
    const fonte = readFileSync(new URL('./seed-editorias-producao.ts', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/console\.log\(.*(DATABASE_URL|env\.)/);
    expect(fonte.match(/\.insert\(/g)).toHaveLength(1);
    expect(fonte).not.toMatch(/\.(update|delete)\(/);
    expect(fonte).toMatch(/onConflictDoNothing/);
  });
});
