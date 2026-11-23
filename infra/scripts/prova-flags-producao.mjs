#!/usr/bin/env node
// Prova (sem rede, sem Vertra) que o resolvedor de flags do commit recusa flag de produto em PRODUÇÃO e a aceita no STAGING (ADR-022, DP-38).
// Uso: node infra/scripts/prova-flags-producao.mjs --root <checkout do commit a implantar> [--flag intelligencePessoas]
// Importa packages/contracts/src/flags.ts do checkout (Node com type stripping) e confere, com APP_ENV de cada ambiente:
//   1. production + LN_FLAGS_ON=<flag>  -> a subida é RECUSADA ("sem decisão para production");
//   2. production sem LN_FLAGS_ON       -> nenhuma flag ligada;
//   3. staging + LN_FLAGS_ON=<flag>     -> liga só essa flag, com a decisão registrada;
//   4. staging + nome desconhecido      -> RECUSADA.
// Sai com 0 se tudo confere; 1 se alguma prova falha; 2 em uso errado. Imprime uma linha JSON. Nunca lê segredo.
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from './lib/util.mjs';

export async function provar(root, flag) {
  const arq = join(root, 'packages', 'contracts', 'src', 'flags.ts');
  if (!existsSync(arq)) throw new Error('packages/contracts/src/flags.ts ausente neste checkout');
  const m = await import(pathToFileURL(arq).href);
  const tenta = (env) => { try { const r = m.resolveFlags(env); return { ok: true, linha: String(r.logLine ?? ''), ligadas: Object.entries(r.state ?? {}).filter(([, v]) => v === true).map(([k]) => k).sort() }; } catch (e) { return { ok: false, erro: String(e?.message ?? e).slice(0, 200) }; } };
  const prod = tenta({ APP_ENV: 'production', LN_FLAGS_ON: flag });
  const prodLimpo = tenta({ APP_ENV: 'production' });
  const stg = tenta({ APP_ENV: 'staging', LN_FLAGS_ON: flag });
  const desconhecida = tenta({ APP_ENV: 'staging', LN_FLAGS_ON: 'flagQueNaoExiste' });
  const provas = [
    { nome: `production + ${flag}: subida recusada`, ok: prod.ok === false && /sem decisão para production/.test(prod.erro ?? ''), detalhe: prod.erro ?? prod.linha },
    { nome: 'production limpa: nenhuma flag ligada', ok: prodLimpo.ok === true && prodLimpo.ligadas.length === 0, detalhe: prodLimpo.linha },
    { nome: `staging + ${flag}: liga só essa flag`, ok: stg.ok === true && stg.ligadas.length === 1 && stg.ligadas[0] === flag, detalhe: stg.linha },
    { nome: 'staging + flag desconhecida: subida recusada', ok: desconhecida.ok === false, detalhe: desconhecida.erro ?? desconhecida.linha },
  ];
  return { flag, ok: provas.every((p) => p.ok), provas };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root || args.root === true) { console.error('use --root <checkout do commit>'); process.exit(2); }
  const flag = args.flag && args.flag !== true ? String(args.flag) : 'intelligencePessoas';
  try {
    const r = await provar(resolve(String(args.root)), flag);
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.error(`ERRO: ${e.message}`); process.exit(2); }
}
