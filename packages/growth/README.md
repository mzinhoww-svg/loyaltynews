# @ln/growth — Frente 09 (Growth e mLabs)
Distribuição social. Convenções do scaffold: TypeScript estrito, imports relativos sem extensão, flags e contratos em `@ln/contracts`, testes com Vitest em `src/__tests__/` (raiz: `npm test`, `npm run typecheck`, `npm run lint`).
Amostras: `node scripts/render-sample.ts` (gera `out/samples/`, ignorado pelo git). Criativo: `npm run assets -w @ln/growth` regenera `src/creative/assets.data.ts` a partir de `assets/` (cópia do brandkit).

## Entradas do pacote (`exports`)
| Import | Conteúdo | Onde usar |
|---|---|---|
| `@ln/growth` | tudo do servidor: adaptadores, publisher, copy, criativo, pacotes | workers, rotas de API |
| `@ln/growth/dashboard` | handlers puros do Social Dashboard, store, projeção do `Article` do contrato | `apps/web/app/api` (adapta Request/Response) |
| `@ln/growth/jobs` | job BullMQ de geração de pacote, porta do gateway | `apps/workers` |
| `@ln/growth/ui` | componentes de prévia e view-models, **client-safe** (sem `node:*`) | `apps/web/app/studio` |

## Módulos
| Arquivo | O que faz |
|---|---|
| `src/mlabs/port.ts` | Interfaces de leitura/escrita; listas de ferramentas de leitura e de escrita do mLabs |
| `src/mlabs/simulated.mock.ts` | **MOCK** — adaptador simulado (padrão): nada vai ao mLabs; recibos `SIM-…` |
| `src/mlabs/live.ts` | `createLiveMlabsAdapter` (única forma de obter o adaptador real) e `readOnlyTransport` |
| `src/mlabs/validate.ts` | Validação de capacidades só por leitura (forma das respostas, sem valores) |
| `src/publisher/publisher.ts` | `SocialPublisher`: único caminho de publicação; só a identidade `publisher_social`; flags; gates; imagem aprovada; regras de copy; idempotência; auditoria |
| `src/copy/engine.ts` | Motor de copy LinkedIn + `validateCopy` |
| `src/creative/post.ts` | Criativo de contexto por código (SVG/HTML) a partir do brandkit; 4 formatos; sem fs/Buffer |
| `src/package/linkedin.ts`, `instagram.ts` | Pacote por matéria (LinkedIn) e Instagram (construído, flag desligada) |
| `src/dashboard/handlers.ts` | Handlers puros: resumo, fila, pacote, recibos simulados, auditoria, geração, pedido de publicação SIMULADA |
| `src/dashboard/articles.ts` | `ArticleSource` e `toSocialArticle` (projeta o `Article` do contrato; fatos aprovados vêm da checagem, nunca do corpo) |
| `src/jobs/social-package.job.ts` | Fila `social`, payload só com IDs, jobId determinístico, processador, `enqueueSocialPackage`, `createSocialPackageWorker` |
| `src/jobs/gateway.ts` / `gateway.mock.ts` | Porta do gateway de modelos e versão SIMULADA (**MOCK**) |
| `src/ui/*` | `CreativePreview`, `CopyPreview`, `BlockersList`, `ReceiptList`, `StatusBadge`, `PackageCard`, `PackageQueue`, `DashboardSummaryCards` (createElement, sem JSX) |

## Regras do motor de copy (validadas em código)
1. Só fatos aprovados, com fonte; sem fato com fonte, não há post.
2. **Todo número do texto final (inclusive o do título e do deck) precisa constar em um fato com fonte.** Título e deck não são evidência.
3. Marcação (`@[Nome]`) só para entidade com identidade verificada; sem ela, texto puro; sem suporte da API, fallback para texto puro.
4. Gancho ≤ 210 caracteres, texto ≤ 3000, ≤ 3 hashtags.
5. Link com UTM (LinkedIn), assinatura "Redação Loyalty News", crédito da imagem (o crédito não conta como afirmação numérica).
6. Sem apuração/entrevista/autoria humana inventada.

## Garantias de publicação (ADR-008)
- Redação/design/agentes recebem `identidade_nao_autorizada` (teste negativo). Esta guarda é de software; o controle real é só o serviço de publicação ter a credencial/MCP do mLabs.
- **Adaptador real só por fábrica:** a classe não é exportada; `createLiveMlabsAdapter` exige `liveAck`, ator `publisher_social` e flag `growth_linkedin_live` ligada. A flag (função lida a cada operação) e a identidade são conferidas **dentro** do adaptador antes de qualquer leitura ou escrita; o transporte cru fica em campo privado (`#`). Testes chamam o adaptador real diretamente.
- **Escrita só pelo SocialPublisher:** `createPost`/`updatePost`/`deletePost` de TODO adaptador (real e simulado) exigem uma capability (`WriteCapability`, `src/mlabs/write-gate.ts`) que o publicador recebe ao se vincular (`bindWriteAuthority`, uma vez por adaptador) e guarda em campo privado. Chamada direta, sem a capability ou com uma forjada/de outro objeto, lança `WriteRefused` antes de qualquer efeito (inclusive antes de tocar o transporte real). Um segundo publicador no mesmo adaptador é recusado. Testes: `src/__tests__/write-capability.test.ts`.
- Instagram e The Loyal: chave desligada ⇒ recusa registrada na auditoria, mesmo pela identidade de publicação.
- Sem imagem aprovada ou gates pendentes ⇒ bloqueia. Reenvio com a mesma chave não duplica.
- O dashboard só pede publicação **simulada** e recusa com adaptador real; regera o pacote e compara o hash do criativo (matéria mudou ⇒ 409).
- Criativo carrega `brandStatus` (brandkit está `proposal_not_approved`); o pacote lista `brandkit_proposal_not_approved` como bloqueio de publicação REAL.

## Não verificado / pendente
- Menção, edição, exclusão, PDF de carrossel e 7 dias sem sessão só se provam por escrita em página de teste (R5-02). Leitura do mLabs: ver `docs/mlabs-capabilities.md` §5 (fonte: PM).
- Job testado com Worker/Queue estruturais (fakes), sem Redis nem `bullmq` real; o gateway é simulado (o real é `packages/modelops`, ainda não mesclado).
- Sem rotas em `apps/web/app/api` nem páginas em `apps/web/app/studio` (donos: Backend e Studio): os handlers e os componentes estão prontos para serem importados; e2e de página fica com a frente dona da página.
- Handle verificado de Instagram (sem marcação no Instagram); texto do The Loyal não construído.
