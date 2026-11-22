# Branch de integração `ft/integracao` — como é montado, verificado e empacotado
Autor: LN DevOps Engineer · 22/11/2026. Preparação para o staging; **nada foi enviado ao GitHub ou à Vertra**. O deploy só acontece com o ok do PM depois que o QA 2 homologar portal e Studio.

## 1. Receita reprodutível
```
node infra/scripts/integracao.mjs --repo <clone base> --worktree <pasta> --branch ft/integracao \
  --base ft/scaffold@<sha> --merge ft/portal@<sha> --merge ft/studio@<sha> --merge ft/infra --verify --report <arquivo.json>
node infra/scripts/package-web.mjs --repo <worktree> --commit HEAD --out <releases/staging> --profile staging-min --expect-branch ft/integracao
```
- O branch é **recriado a partir da base** a cada execução (o anterior fica em `ft/integracao-anterior`): não acumula remendos.
- Cada `--merge ref@sha` exige que o SHA **esteja contido no ref**. Se o dono reescrever o histórico (rebase/amend), o script **recusa** e avisa, em vez de integrar um commit órfão. Sem `@sha` usa a ponta atual (não recomendado para homologação).
- Conflito de merge: o merge é abortado, os arquivos são listados e o código de saída é 2; a correção é na origem, com o dono da pasta (regra de ownership do fast-track).
- `--verify`: `npm install`, `lint`, `typecheck`, `npm test`, build do `apps/web`, `verify:no-mock` do Studio e `ci-checks --deploy`; para na primeira falha; relatório JSON com a cauda de cada etapa.
- `package-web.mjs` gera pasta, ZIP e manifesto do commit integrado (ver `deploy-por-zip.md`).

## 2. Composição e resultado (22/11/2026)
Relatórios em `C:\Users\mazin\OpenBot\Shared\loyalty-news\releases\integracao\`; pacote em `...\releases\staging\`.
| Item | Valor |
|---|---|
| Base | `ft/scaffold` 8d5a4dd (o Studio foi rebaseado sobre o scaffold 519d80c; integrá-lo traz esses commits do scaffold junto) |
| Merges | `ft/portal` (SHA do PM), `ft/studio` ac5438b, `ft/infra` |
| Fora (por decisão do PM) | `ft/backend` (auth em correção; staging mínimo usa `APP_MODE=nodb`), demais frentes |
| Resultado | etapa a etapa nos relatórios JSON (seção 4) |

## 3. Pontos de atenção
- **Alvos que se movem.** Durante a montagem os SHAs mudaram várias vezes (Studio `c865d84` → `74c2148` → rebase → `ac5438b`; portal `4fcc01a` → `cd6a0f5` → `288a0cd`; scaffold `b940cfd` → `8d5a4dd` → `519d80c`). `74c2148` virou órfão por rebase: o commit equivalente rastreável é `ac5438b` (mesma mensagem, mesmo conteúdo; diferem só pelos arquivos do scaffold da nova base). Sempre fixar SHA e conferir `merge-base --is-ancestor`.
- O worktree do Studio tinha alteração **não commitada** (`Sidebar.tsx`) quando consultei: não entra em nenhuma integração (só commits).
- As duas correções mínimas que apliquei numa versão anterior (tsconfig/eslint na raiz) **deixaram de ser necessárias**: o Chief Architect corrigiu na origem. A versão antiga está em `ft/integracao-anterior`.
- `ci-checks --deploy` sobre o conjunto passou depois de refinar duas regras (PEM de fixture de 4 caracteres em `packages/db`; `next.config.ts` do Studio que só **lê** `LN_STUDIO_TEST_SESSION` para recusar o build).
- Ruído esperado nos testes: o jsdom avisa "HTMLCanvasElement getContext not implemented" (falta `@napi-rs/canvas`); não falha nada.

## 4. Resultados e ensaio do pacote (ficam FORA do repositório)
Para o commit integrado não carregar resultados que mudam a cada rodada, cada execução grava em `C:\Users\mazin\OpenBot\Shared\loyalty-news\releases\`:
- `integracao\integracao-<data>.json`: base, merges com SHA, SHA do commit integrado e o resultado e a cauda de cada etapa de `--verify`;
- `staging\ln-web-staging-min-<sha12>\` (pasta), `.zip` e `.manifest.json`: o pacote, com o SHA-256 do ZIP e os comandos exatos;
- `staging\ensaio-<sha12>.txt`: saída de `node infra/scripts/ensaio-pacote.mjs --manifest <manifesto>`, que instala a partir da pasta do pacote, prova que o guard recusa build e start com `LN_STUDIO_TEST_SESSION` ou `PORTAL_SOURCE=mock`, compila e sobe com os comandos do manifesto, e roda as sondas (commit certo, Studio negando sem login, nenhum "MOCK" no portal);
- `staging\LEIA-ME.md`: SHAs e hashes da última versão pronta para o PM.