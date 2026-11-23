# Rodar migração e checagens com credenciais SEM expô-las (staging e produção)

Para `check-conexoes.mjs` e `migrate.mjs` o processo precisa de `DATABASE_URL`, `DB_SSL_CA_PEM`, `DB_SSL_CERT_PEM`, `DB_SSL_KEY_PEM` (e, para o Redis, `REDIS_URL` e `REDIS_SSL_*_PEM`). Regra: o valor nasce na Vertra, vive só na **memória** de um script do PM e vai **direto** para o ambiente do processo filho (ou para o `set_env` de um app). Nunca em arquivo, em chat, em log nem em argumento de linha de comando. Os scripts de infra já não imprimem URL nem PEM.

## O que a Vertra oferece (docs.vertracloud.app; API em https://api.vertracloud.app, `Authorization: Bearer <chave>`)
- `GET /v1/databases/{id}` → host, porta, usuário (`vertracloud`), nome do banco (`vertracloud`).
- `GET /v1/databases/{id}/credentials/certificate` → CA do servidor, certificado e chave de cliente. **Repetível**: ler de novo não muda nada.
- `POST /v1/databases/{id}/credentials/reset` (ferramenta `reset_credentials`) → gera uma **senha nova** e a devolve; **a anterior para de valer** na hora (quem estiver conectado cai). A API nunca devolve a senha atual.
- `POST /v1/apps/{id}/envs` (ferramenta `set_env`) e `DELETE /v1/apps/{id}/envs/{env_id}` (`delete_env`).
- - **Formato verificado pelo PM em 23/11/2026** (execução real do staging): a API envolve as respostas em `{ "response": { ... } }` (ler `.response`); o certificado traz os campos `crt`, `key`, `pem`, `ca` e `p12`; `POST /v1/databases/{id}/credentials/reset` vai **sem corpo** (enviar `content-type: application/json` sem corpo dá HTTP 400). Na primeira execução o script ainda deve mostrar só os NOMES dos campos se algo divergir.

## REGRA OBRIGATÓRIA: PEM em UMA linha com \n escapado em toda variável de app (achado do PM em 23/11/2026, Fase 3)
**A Vertra repassa ao processo SÓ A PRIMEIRA LINHA de uma variável multilinha.** Gravar um PEM com quebras de linha reais por `set_env` entrega ao app apenas `-----BEGIN CERTIFICATE-----`: o código passa na validação (`BEGIN` presente) e o OpenSSL falha depois com `error:0480006C:PEM routines::no start line` (e o Redis responde 'Connection is closed'). Sintoma que engana: a conferência feita no script (que mostra o valor INTEIRO, multilinha) parece certa; nenhuma ferramenta lê o valor da variável no app.
Regra: **todo** `*_PEM` (`DB_SSL_CA_PEM`, `DB_SSL_CERT_PEM`, `DB_SSL_KEY_PEM`, `REDIS_SSL_CA_PEM`, `REDIS_SSL_CERT_PEM`, `REDIS_SSL_KEY_PEM`) vai para o `set_env` em UMA linha, com cada quebra trocada pela sequência de dois caracteres `\n`: `pem.trim().replace(/\r?\n/g, '\\n')`. O código do produto desescapa (`normalizePem` em `packages/db/src/tls.ts`, usado pelo web, pelo worker e pelo Redis) e as ferramentas de infra também (`check-conexoes.mjs`, `migrate.mjs`). Valor máximo de 3072 caracteres por variável: um PEM em uma linha tem o mesmo tamanho. Isso vale para staging E para produção.
Para variáveis do **processo filho** (migração, seed, checagem) o script pode passar o PEM multilinha normalmente: o problema é só o transporte da Vertra para o app.
Diagnóstico sem expor conteúdo, se voltar a acontecer: `releases\staging\diagnostico-pem-start.txt` (start temporário que mostra só estrutura: tamanho, linhas, BEGIN/END e se o Node interpreta).

## Regra da senha (por causa do `reset`)
A senha só existe se for gerada: cada `reset` invalida a anterior. Portanto:
1. **Antes de existir app usando o banco** (hoje: staging, só migração e checagem): pode girar a senha a cada execução e descartá-la. Ninguém depende dela.
2. **Quando os apps entram (Fase 3):** gire a senha **uma vez** e grave o mesmo valor nos apps que usam o banco (web e worker) na MESMA execução (`set_env` nos dois), e só então reinicie os dois. Nesse momento o valor existe apenas dentro do ambiente dos apps.
3. **Migração depois da Fase 3** (nova migração, ou qualquer acesso do DevOps): o script gira a senha, atualiza `DATABASE_URL` em web e worker via `set_env`, roda o comando com a senha em memória e reinicia web e worker. É uma troca de credencial com reinício curto, planejada. (Alternativa, se o proprietário preferir: guardar a senha no cofre do OpenBot e injetá-la sem girar; é decisão dele.)
4. Nunca girar a senha de produção fora de uma janela combinada: a produção cai até os apps receberem a nova.

## Modelo do script (fica FORA do repositório, na pasta de scripts do PM; não imprime valor)
```js
// ln-com-credenciais.mjs  — uso: node ln-com-credenciais.mjs staging -- node infra/scripts/check-conexoes.mjs --env staging
import { spawnSync } from 'node:child_process';
const API = 'https://api.vertracloud.app/v1';
const KEY = process.env.LN_VERTRA_DEPLOY_API_KEY;            // já está no ambiente do PM; não imprimir
const H = { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
const DBS = { staging: { pg: '862011ce-0c0a-4472-a2a1-dbb341808f00', redis: 'fb65640c-2a45-4db1-aea2-065151179ab7' } };

async function call(method, path, body) {
  const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path} -> HTTP ${r.status}`);        // nunca ecoar o corpo
  return r.json();
}
const achar = (o, nomes) => { for (const n of nomes) if (typeof o?.[n] === 'string' && o[n]) return o[n]; throw new Error('campo ausente; chaves da resposta: ' + Object.keys(o ?? {}).join(',')); };

async function ambienteDe(id, prefixoPem, urlVar, esquema) {
  const info = await call('GET', `/databases/${id}`);                          // host, port, username
  const cert = await call('GET', `/databases/${id}/credentials/certificate`);  // formato a confirmar (primeira vez: só as chaves)
  const senha = achar(await call('POST', `/databases/${id}/credentials/reset`), ['password', 'new_password', 'senha']);
  const host = achar(info, ['host']);  const porta = achar({ p: String(info.port) }, ['p']);
  return {
    [urlVar]: `${esquema}://${encodeURIComponent(info.username ?? 'vertracloud')}:${encodeURIComponent(senha)}@${host}:${porta}${esquema === 'postgres' ? '/vertracloud' : ''}`,
    [`${prefixoPem}_CA_PEM`]: achar(cert, ['ca', 'ca_pem', 'ca_certificate']),
    [`${prefixoPem}_CERT_PEM`]: achar(cert, ['cert', 'certificate', 'client_certificate', 'crt']),
    [`${prefixoPem}_KEY_PEM`]: achar(cert, ['key', 'client_key', 'private_key']),
  };
}

const amb = process.argv[2];  const cmd = process.argv.slice(process.argv.indexOf('--') + 1);
const env = { ...process.env, APP_ENV: amb,
  ...(await ambienteDe(DBS[amb].pg, 'DB_SSL', 'DATABASE_URL', 'postgres')),
  ...(DBS[amb].redis ? await ambienteDe(DBS[amb].redis, 'REDIS_SSL', 'REDIS_URL', 'rediss') : {}) };
const r = spawnSync(cmd[0], cmd.slice(1), { env, stdio: 'inherit', cwd: process.env.LN_CHECKOUT });  // segredos só no ambiente do filho
process.exit(r.status ?? 1);
```
Para a Fase 3, o mesmo script ganha um passo `POST /apps/{id}/envs` com `{ key, value }` para cada variável nos apps de destino (sem imprimir), e `BETTER_AUTH_SECRET = crypto.randomBytes(48).toString('base64url')` direto no `set_env`.

## Fase 1 (staging) com esse script
Checkout pronto com `node_modules` e `bindings.json` do staging: `C:\Users\mazin\OpenBot\Shared\loyalty-news\code\wt-migrar` (`LN_CHECKOUT` aponta para ele).
1. `node ln-com-credenciais.mjs staging -- node infra/scripts/check-conexoes.mjs --env staging` → `postgres ok …` e `redis ok …`.
2. `… -- node infra/scripts/migrate.mjs --env staging --dry-run` e depois sem `--dry-run` → `migração OK e verificada em staging`.
Não precisa de `psql`: a checagem, o `--first-run-empty` e o `verify-migrations` usam o módulo `pg` do checkout.

## Fase 3 do staging (web e worker recebem as credenciais): uma execução do script, mesmo valor nos dois apps
Ordem (detalhes e argumentos em `releases\staging\PEDIDO-FASE3-staging-completo.md`): 1) migração, checagem e seed com credencial EFÊMERA (cada execução gira a senha; nenhum app usa o banco ainda); 2) criar o app do worker; 3) **uma** execução que gira a senha do PostgreSQL e a do Redis e grava, direto da memória, as variáveis nos DOIS apps; 4) variáveis finais do web e deploy.
Variáveis (nenhuma é impressa): **web e worker** `DATABASE_URL`, `DB_SSL_CA_PEM`, `DB_SSL_CERT_PEM`, `DB_SSL_KEY_PEM`, `REDIS_URL`, `REDIS_SSL_CA_PEM`, `REDIS_SSL_CERT_PEM`, `REDIS_SSL_KEY_PEM`; **só o web** `BETTER_AUTH_SECRET` (`crypto.randomBytes(48).toString('base64url')`, distinto da produção); **só o worker** `APP_ENV`, `NODE_ENV`, `APP_COMMIT`.
Esboço do passo 3 (script do PM, fora do repositório; reaproveita `ambienteDe` do modelo acima e o helper de `set_env` que ele já usa):
```js
const pg = await ambienteDe(DBS.staging.pg, 'DB_SSL', 'DATABASE_URL', 'postgres');       // gira a senha UMA vez
const rd = await ambienteDe(DBS.staging.redis, 'REDIS_SSL', 'REDIS_URL', 'rediss');       // gira a senha UMA vez
const comuns = { ...pg, ...rd };
const achatar = (pem) => pem.trim().replace(/\r?\n/g, '\\n');                                          // PEM em UMA linha com \n escapado (regra acima)
for (const app of [WEB_ID, WORKER_ID]) for (const [k, v] of Object.entries(comuns)) await setEnv(app, k, /_PEM$/.test(k) ? achatar(v) : v);   // sem log do valor
await setEnv(WEB_ID, 'BETTER_AUTH_SECRET', crypto.randomBytes(48).toString('base64url'));
for (const [k, v] of Object.entries({ APP_ENV: 'staging', NODE_ENV: 'production', APP_COMMIT: COMMIT })) await setEnv(WORKER_ID, k, v);
```
Depois dessa execução a senha existe só no ambiente dos dois apps. **Qualquer acesso posterior do DevOps ao banco** (nova migração, seed) gira de novo e exige atualizar `DATABASE_URL`/`REDIS_URL` no web E no worker e reiniciar os dois (ou o proprietário decide guardar a senha no cofre). Um erro comum a evitar: girar a senha numa execução de teste depois que os apps já têm a senha antiga (derruba os dois apps).

## Depois da Fase 3: acesso ao banco e o BETTER_AUTH_SECRET (CLI de administrador do staging)
Achado (23/11/2026): o plugin de segundo fator do Better Auth (`twoFactor`, 1.7.27) **cifra o segredo do TOTP com o `BETTER_AUTH_SECRET`** (`symmetricEncrypt`). A CLI `staging-admin` (ft/backend 1a6bb69; Security, decisão 14) cria o administrador JÁ com o TOTP ativo, gravado no banco cifrado com o segredo do processo que a roda. Se ela rodar com um segredo diferente do que o WEB tem, o login com o código do autenticador **falha** (o web não decifra o TOTP).
Como o segredo foi gerado dentro do script da Fase 3 e só existe no ambiente do web (nenhuma ferramenta lê o valor de uma variável do app), a CLI só funciona assim, numa **única execução** do script do PM (staging, sem sessões a perder):
1. Gerar um `BETTER_AUTH_SECRET` novo (`crypto.randomBytes(48).toString('base64url')`, só na memória).
2. Girar a senha do PostgreSQL e atualizar `DATABASE_URL` no web E no worker (regra da senha, acima); gravar o segredo novo no web (`set_env BETTER_AUTH_SECRET`).
3. Rodar a CLI com o MESMO segredo e a MESMA senha no ambiente do processo filho, dentro de um checkout com `node_modules`: `APP_ENV=staging` `BETTER_AUTH_URL=https://loyaltynews-stg.vertraweb.app` (a origem pública do Studio; o handler confere) `BETTER_AUTH_SECRET`, `DATABASE_URL`, `DB_SSL_*_PEM`; `node apps/workers/dist/staging-admin.js --confirm-staging-bootstrap --secret-file <caminho fora do repositório>` (a CLI exige `--confirm-staging-bootstrap` e entrega os segredos só por `--tty` ou `--secret-file`; nada em stdout; o PM guarda o login no Cofre do OpenBot e apaga o arquivo).
4. `restart_app` do web e do worker (ambos passam a ter a senha nova do banco e o web, o segredo novo).
**Guarde o `BETTER_AUTH_SECRET` no cofre do OpenBot** (item `ln-stg-auth-secret`): trocar o segredo sem refazer o administrador invalida o TOTP e as sessões.
Produção: o 1º administrador NÃO usa essa CLI (cerimônia à parte com o proprietário); o mesmo princípio vale: quem cria o usuário e o web têm de compartilhar o `BETTER_AUTH_SECRET` da produção.
