# Rodar migração e checagens com credenciais SEM expô-las (staging e produção)

Para `check-conexoes.mjs` e `migrate.mjs` o processo precisa de `DATABASE_URL`, `DB_SSL_CA_PEM`, `DB_SSL_CERT_PEM`, `DB_SSL_KEY_PEM` (e, para o Redis, `REDIS_URL` e `REDIS_SSL_*_PEM`). Regra: o valor nasce na Vertra, vive só na **memória** de um script do PM e vai **direto** para o ambiente do processo filho (ou para o `set_env` de um app). Nunca em arquivo, em chat, em log nem em argumento de linha de comando. Os scripts de infra já não imprimem URL nem PEM.

## O que a Vertra oferece (docs.vertracloud.app; API em https://api.vertracloud.app, `Authorization: Bearer <chave>`)
- `GET /v1/databases/{id}` → host, porta, usuário (`vertracloud`), nome do banco (`vertracloud`).
- `GET /v1/databases/{id}/credentials/certificate` → CA do servidor, certificado e chave de cliente. **Repetível**: ler de novo não muda nada.
- `POST /v1/databases/{id}/credentials/reset` (ferramenta `reset_credentials`) → gera uma **senha nova** e a devolve; **a anterior para de valer** na hora (quem estiver conectado cai). A API nunca devolve a senha atual.
- `POST /v1/apps/{id}/envs` (ferramenta `set_env`) e `DELETE /v1/apps/{id}/envs/{env_id}` (`delete_env`).
- - **Formato verificado pelo PM em 23/11/2026** (execução real do staging): a API envolve as respostas em `{ "response": { ... } }` (ler `.response`); o certificado traz os campos `crt`, `key`, `pem`, `ca` e `p12`; `POST /v1/databases/{id}/credentials/reset` vai **sem corpo** (enviar `content-type: application/json` sem corpo dá HTTP 400). Na primeira execução o script ainda deve mostrar só os NOMES dos campos se algo divergir.

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
