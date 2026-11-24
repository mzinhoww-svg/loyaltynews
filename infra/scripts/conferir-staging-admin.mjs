#!/usr/bin/env node
// Conferência SÓ-LEITURA depois da CLI staging-admin (apps/workers/src/staging-admin.ts): o administrador de staging existe, é um só, tem o 2º fator
// ativo, não ficou sessão aberta e a auditoria registrou o bootstrap. Imprime só contagens e booleanos: nunca e-mail, senha, segredo TOTP, hash, código nem URL.
// Uso (na raiz de um checkout com node_modules/pg), com as credenciais só no processo filho (ln-com-credenciais):
//   node infra/scripts/conferir-staging-admin.mjs
// Ambiente: APP_ENV=staging, DATABASE_URL (tem de ser o banco de staging registrado em infra/vertra/bindings.json), DB_SSL_CA_PEM, DB_SSL_CERT_PEM, DB_SSL_KEY_PEM.
// Saída: uma linha JSON. Código 0 = tudo confere; 1 = algo não confere; 2 = ambiente recusado.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertBound, canonEnv } from './lib/binding.mjs';

/** Pura (testada): decide a partir das contagens. */
export function avaliar(c) {
  const provas = [
    { nome: 'um único administrador', ok: c.admins === 1 },
    { nome: 'e-mail do administrador termina em .invalid (conta só de staging)', ok: c.adminsInvalid === 1 },
    { nome: '2º fator ativo no usuário', ok: c.adminsComDoisFatores === 1 },
    { nome: 'registro de 2º fator verificado (um)', ok: c.doisFatoresVerificados === 1 },
    { nome: 'nenhuma sessão aberta pelo bootstrap', ok: c.sessoes === 0 },
    { nome: 'auditoria bootstrap_admin_staging registrada', ok: c.auditorias >= 1 },
  ];
  return { ok: provas.every((p) => p.ok), provas };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fail = (m, code) => { console.error(m); process.exit(code); };
  const env = process.env;
  if (canonEnv(env.APP_ENV) !== 'staging') fail('recusado: APP_ENV tem de ser staging', 2);
  try { assertBound({ env: 'staging', databaseUrl: env.DATABASE_URL, root: process.cwd() }); } catch (e) { fail(`recusado: ${e.message}`, 2); }
  for (const k of ['DB_SSL_CA_PEM', 'DB_SSL_CERT_PEM', 'DB_SSL_KEY_PEM']) if (!env[k]) fail(`recusado: falta ${k}`, 2);
  const require = createRequire(join(process.cwd(), 'package.json'));
  const { Client } = require('pg');
  const url = new URL(env.DATABASE_URL);
  const client = new Client({
    host: url.hostname, port: Number(url.port), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1),
    ssl: { ca: env.DB_SSL_CA_PEM, cert: env.DB_SSL_CERT_PEM, key: env.DB_SSL_KEY_PEM, rejectUnauthorized: true, servername: url.hostname },
  });
  client.on('error', () => { /* só a classe sai abaixo; nunca o erro inteiro (pode trazer host/credencial) */ });
  try {
    await client.connect();
    await client.query('begin read only');
    const n = async (sql) => Number((await client.query(sql)).rows[0].n);
    const c = {
      admins: await n("select count(*) n from auth_user where role = 'admin'"),
      adminsInvalid: await n("select count(*) n from auth_user where role = 'admin' and email like '%.invalid'"),
      adminsComDoisFatores: await n("select count(*) n from auth_user where role = 'admin' and two_factor_enabled"),
      doisFatoresVerificados: await n("select count(*) n from auth_two_factor f join auth_user u on u.id = f.user_id where u.role = 'admin' and f.verified"),
      sessoes: await n("select count(*) n from auth_session s join auth_user u on u.id = s.user_id where u.role = 'admin'"),
      auditorias: await n("select count(*) n from audit_log where action = 'bootstrap_admin_staging'"),
    };
    await client.query('rollback');
    const r = avaliar(c);
    console.log(JSON.stringify({ ...r, contagens: c }));
    await client.end();
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error(`falha: ${e?.name ?? 'Erro'}${e?.code ? ` ${e.code}` : ''}`);
    try { await client.end(); } catch { /* já fechado */ }
    process.exit(1);
  }
}
