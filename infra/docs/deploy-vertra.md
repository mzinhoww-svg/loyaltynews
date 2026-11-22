# Deploy na Vertra — configuração e plano de recursos (frente 01)
Autor: LN DevOps Engineer · 22/11/2026 · Estado: **preparado, nada aplicado** (fast-track regra 6: sem escrita na Vertra). Base: ADR-001 e ADR-012 (propostas, não aceitas), R0-07 v2 e a documentação oficial da Vertra lida em 22/11/2026. Especificação em máquina: `infra/vertra/environments.json`; variáveis (só nomes): `infra/vertra/env-contract.json`.

## 1. Como cada app é implantado a partir do GitHub
A Vertra baixa o repositório como arquivo (**sem `.git`**), instala dependências, roda `build_command` e inicia com `start_command`, **sempre na raiz do repositório** (não há "diretório raiz" por app). Como `apps/web` e `apps/workers` moram no mesmo repositório, **cada um vira uma app Vertra separada** apontando para o mesmo repositório, com comandos próprios via workspaces do npm. Cada app instala todas as dependências do monorepo (limite de instalação 15 min, de build 10 min; ambiente de build com o dobro da RAM da app, mínimo 1024 MB).

| App | Tipo Vertra | Build | Start | Health check |
|---|---|---|---|---|
| web (Next.js) | Website (porta 80, `0.0.0.0`) | `npm run build -w apps/web` | `npx next start apps/web -p 80 -H 0.0.0.0` | `/api/health` |
| workers (BullMQ) | Bot (sem porta) | `npm run build -w apps/workers` | `node apps/workers/dist/index.js` | sem HTTP: batimento no Redis, visível em `/api/ready` |

Branches: **staging** faz deploy da branch `staging`; **produção** da `main` (que só recebe merge commit por PR, ruleset `main-protection`). Auto-deploy por push existe em todos os planos; **não verifiquei** se dá para desligá-lo por app — se não der, a proteção da produção é o próprio ruleset de `main`. Um push acima de 60 deploys/hora é ignorado (não entra em fila).
A versão do commit não chega ao app: quem faz o deploy atualiza `APP_COMMIT` (o `/api/health` devolve como `version` e a sonda confere).
**Ensaiado localmente no scaffold `ft/scaffold` 78a271c** (Node 26.13.1, Next 16.4.6, 22/11/2026): `npm install` na raiz (29 s), `npm run build -w apps/web` (13 s, exit 0) e `npx next start apps/web -p <porta> -H 127.0.0.1` sobem o app (home 200, `/api/health` 200): o `next` é resolvido pela raiz (hoisting dos workspaces) e os dois comandos da tabela funcionam. **Ainda não rodou na Vertra** (build real e tempo em nuvem não verificados). `apps/workers` ainda não existe (frente 02).

## 2. Health check e zero downtime
- **Health check** da Vertra: chama `deploy.health_check_path` na versão nova (5 s por tentativa, duas respostas boas seguidas, qualquer HTTP conta como saudável **exceto 5xx**, recusa e timeout). `/api/health` precisa ser **raso**: responde 200 sem tocar banco nem Redis. Se checasse dependência, uma queda do banco derrubaria o deploy e o rollback.
- **`/api/ready`** (profundo, só para monitoria): `db`, `redis`, `workers` (batimento no Redis); 200 com `ok` ou `degraded`, 503 se algo crítico cair. Contrato e pedido ao Backend em `observabilidade.md`.
- **Zero downtime** (`deploy.zero_downtime`, Pro tem): a doc da Vertra avisa que um Next.js **compilado** lê arquivos a cada requisição e, com as duas versões na **mesma pasta**, a antiga pode servir arquivos misturados durante a instalação/build; "para esses, use `off`". Decisão:
  - **staging: `auto`** — serve de ensaio do risco: deploy repetido com a sonda contínua (`healthcheck.mjs`) e contagem de erros.
  - **produção web: `off` no começo**; passa a `auto` só se o ensaio em staging mostrar zero erros.
  - **workers: `off`** — com `on` duas cópias rodam juntas e processariam jobs em duplicidade. Mitigação de qualquer modo: tratar `SIGTERM` (parar de pegar jobs, concluir o corrente, fechar BullMQ) e ids de job idempotentes.
  - Migração roda enquanto a versão antiga ainda serve: **só mudanças compatíveis para trás** (expandir → migrar dados → contrair, em deploys separados).
- **Rollback automático** (Pro): ligado em web e workers (desligado por padrão na Vertra). Se a versão nova parar em até 60 s, volta uma vez para a anterior (só código, não variáveis).

## 3. Recursos e RAM (staging e produção)
Mínimos da Vertra: publicar um site exige 512 MB; PostgreSQL 1024 MB; Redis 512 MB; app 100 MB.
| Recurso | staging-min | staging | produção |
|---|---:|---:|---:|
| web (Next.js) | 512 | 512 | 512 |
| workers | — | 256 | 384 |
| PostgreSQL 18 | — | 1024 | 1024 |
| Redis 8.2 | — | 512 | 512 |
| **Total (MB)** | **512** | **2304** | **2432** |
| Blob | — | pasta privada | pasta privada |
Blob não consome RAM: usa a cota da conta (50 GB no `pro-4`). **Blob na Vertra não tem backup** ("exclusão é permanente"): a ADR-012 só cobre o banco; ativos críticos precisam de cópia externa por decisão do proprietário. Uploads simples abaixo do Business: 1 por segundo.

**Capacidade** — o proprietário subiu a conta para **`pro-8`**: `get_profile` (22/11/2026, ~18h35 BRT) mostra **8192 MB de limite, 3072 MB usados pelos 6 recursos de outros projetos e 5120 MB livres** (os campos `owner_plan` de cada recurso ainda diziam `pro-4` na mesma leitura: provável campo atrasado, não verificado). Os 3072 MB dos outros projetos **não podem ser tocados**.
| Cenário | Livre | Cabe | Sobra |
|---|---:|---|---:|
| **`pro-8` (atual)** | 5120 MB | **staging (2304) + produção (2432) = 4736**, cada um com banco e Redis próprios | **384 MB** |
| mesmo plano, se faltar RAM no futuro | — | staging e produção no **mesmo PostgreSQL, em schemas separados**: economiza 1024 MB | — |
**Recomendação: staging e produção com bancos separados.** Schemas separados num banco só perdem isolamento (migração ou carga ruim em staging afeta produção; backup e restauração ficam acoplados; mesma credencial/certificado), então ficam como reserva. A folga é pequena (384 MB, 7,5%): se o web de produção precisar de 1024 MB (4736 + 512 = 5248 > 5120), reduzir os workers de produção para 256 MB e/ou recorrer ao banco único com schemas. Ordem de implantação sugerida: `staging-min` (web, sem banco) → resto do staging → produção, cada passo com homologação do QA e ok do PM.

## 4. Primeiro passo: staging mínimo (`staging-min`, 512 MB)
Só `apps/web` em SSR, `APP_MODE=nodb`: sem banco, Redis ou workers. É o caminho mais rápido para um staging navegável e um deploy ensaiado, **antes** de o banco e os workers existirem (agora cabe com folga no `pro-8`; não é mais uma restrição de capacidade, é de ordem de entrega). Conteúdo de fixtures com o texto `MOCK` visível (regra 2 do fast-track); métricas e audiência comerciais nunca fictícias (estado vazio). `/api/health` = 200; `/api/ready` = `degraded` com `db: "not_configured"`. Pedido de código: Backend (`/api/health`, `/api/ready`, modo `nodb`) e donos de cada tela (marcar MOCK). O mesmo app ganha banco e Redis depois (`APP_MODE` removido), sem recriar.

## 4b. Endereço
Por ora, subdomínios da Vertra: `loyaltynews-staging.vertraweb.app` (staging) e `loyaltynews.vertraweb.app` (produção), **se disponíveis** (só se confirma ao definir o subdomínio, que é escrita; se ocupado, usar uma variante). Variável `APP_URL`. Domínio próprio depois: o `pro-8` permite 2 domínios por app, com SSL automático e redirecionamento 308 do apex. Não verifiquei disponibilidade.

## 5. Pasta/workspace e chaves de API
- **Recomendado**: workspace `loyalty-news` (Pro permite até 5 membros, papéis e chaves próprias), separado dos 6 recursos de outros projetos. Recursos de workspace usam o plano do dono (não somam memória extra: **não verificado**, FinOps também marca assim). Criar workspace é escrita: só no deploy, por quem tiver chave.
- **Chaves** (máximo 10 por conta; cada chave aceita até 20 IPs permitidos): 
  1. `ln-deploy-staging` e `ln-deploy-prod`: `apps:read apps:write apps:envs apps:files databases:read snapshots:read` (sem `*:delete`, sem `databases:credentials`, sem `billing:*`). `apps:files` é exigido para mudar build/start command.
  2. `ln-provision` (curta, uso único, revogada ao final): `databases:write databases:credentials blob:write workspaces:write` para criar banco/Blob e ler certificados.
  3. Leitura (`ln-r0-inventory-ro`) segue como está.
  4. Chave Blob por ambiente, restrita à pasta (`blob_prefix`); as credenciais S3 derivadas herdam o limite.
  Valores só no cofre do OpenBot; nunca em arquivo, chat ou commit.

## 6. Ações fixadas e versões
`actions/checkout` v7.0.1 `3d3c42e5…90b1`; `actions/setup-node` v7.1.0 `949feb24…15c1` (consultado 22/11/2026, `get_tag`); demais em `r0-preparacao/R0-03/bootstrap/pins.md`. Imagem `postgres:18` do job de migrações **sem digest** (pendência).

## 7. Não verificado
Região do banco (host `usa1`) e rede privada; auto-deploy desligável por app; hoisting do `next`; nomes exatos das credenciais S3 do Blob; quanto tempo leva build real na Vertra; se workspace soma memória do dono; disponibilidade dos subdomínios; a leitura do `owner_plan` por recurso (ainda `pro-4`) após o upgrade. Nenhum recurso foi criado, alterado ou apagado; só leituras (R0-07 e `get_profile` de 22/11).
