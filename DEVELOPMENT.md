# Desenvolvimento — Loyalty News (monorepo)

Regras comuns: `fast-track/README.md` e `implementation-office.md` (pasta compartilhada). Os arquivos do pacote de governança (`governance/`, `contracts/`, `tools/`, `verifier-kit/`, `docs/`, `prompts/`, `tests/`, `audit-output/`, `.mcp.json`) são **protegidos**: não edite.

## Requisitos
- Node 22+ (testado com Node 26.13 e npm 11.20). No Git Bash: `export PATH="/c/Program Files/nodejs:$PATH"`.
- Sem Postgres nem Docker local: os testes de banco usam **PGlite** (PostgreSQL em WASM, em memória).
- `git config core.autocrlf false`.

## Comandos (na raiz)
| Comando | O que faz |
|---|---|
| `npm install` | Instala todos os workspaces |
| `npm run dev` | Next.js em http://localhost:3000 (portal `/`, `/studio`, `/api/health`) |
| `npm test` | Vitest (pacotes + `apps/web/lib`) |
| `npm run typecheck` | `tsc` estrito na raiz e no app |
| `npm run lint` | ESLint (flat config, typescript-eslint) |
| `npm run build` | Build de produção do `apps/web` |
| `npm run e2e` | Playwright (sobe `next start` na porta 3100; requer `npm run build` antes e `npx playwright install chromium` uma vez) |
| `npm run db:generate` | Gera migração SQL a partir de `packages/db/src/schema.ts` (drizzle-kit) |
| `npm run check` | lint + typecheck + test + build |

## Layout
- `apps/web`: Next.js App Router. `app/(portal)` (Frente 03), `app/studio` (Frente 04), `app/api` (Frente 02 Backend).
- `packages/contracts`: schemas zod e tipos compartilhados, **e `flags.ts` com todas as flags desligadas**. Dono: Chief Architect.
- `packages/db`: Drizzle (PostgreSQL 18), migrações em `packages/db/drizzle/`, helper de teste `@ln/db/testing` (PGlite). Dono: Chief Architect.
- `packages/{ui,editorial,agents,intelligence,growth,commercial,modelops,auth}`: um pacote por frente (ver a tabela de ownership no README do fast-track).

## Convenções
- Pacotes são TypeScript-fonte (`exports` aponta para `src/index.ts`); o Next transpila (`transpilePackages`).
- **Imports relativos sem extensão** (`from './x'`): o Turbopack não resolve `export * from './x.js'` para arquivo `.ts`.
- Mocks só em `fixtures/` ou `*.mock.ts`, com `MOCK` visível quando renderizados. Métricas e audiência nunca fictícias.
- Funcionalidade incompleta atrás de flag em `@ln/contracts` (desligada por padrão).
- Testes junto com o código; e2e em `apps/web/e2e` (a pasta `tests/` da raiz é protegida e contém a suíte da governança).
- Nada de deploy, escrita na Vertra, publicação no mLabs, pagamento ou e-mail a pessoas.
