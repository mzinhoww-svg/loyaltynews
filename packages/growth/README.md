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
| `src/mlabs/simulated.mock.ts` | **MOCK** (INTERNO, não exportado) — adaptador simulado (padrão): nada vai ao mLabs; recibos `SIM-…` |
| `src/mlabs/live.ts`, `live-adapter.internal.ts` | Público: `readOnlyTransport`, `LIVE_ACK`, `LiveAdapterRefused`. O adaptador real (classe e construtor) é INTERNO e só `createSocialPublisher` o cria |
| `src/mlabs/write-gate.internal.ts`, `adapter-types.internal.ts` | INTERNOS: capability de escrita e tipos do adaptador com escrita (nada disto sai do pacote) |
| `src/mlabs/create-post-draft.ts` | `linkedinDraftMapper`: `PostPayload` → `create_post` do mLabs **só como rascunho** (`status: draft`, nunca agenda), `requestId` derivado, documento/PDF, recusa menção e mídia sem upload. Esquema lido em 23/11/2026; comportamento real não verificado (R5-02) |
| `src/mlabs/validate.ts` | Validação de capacidades só por leitura (forma das respostas, sem valores) |
| `src/publisher/publisher.ts` | `createSocialPublisher(config)`: único caminho de publicação e a única forma de obter um adaptador. Cria o adaptador (simulado ou real) e a capability de escrita no mesmo passo e os mantém em closure; só a identidade `publisher_social`; flags; gates; imagem aprovada; regras de copy; idempotência; auditoria |
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
- **Sem adaptador fora do publicador:** nem a classe do adaptador (simulado ou real), nem `mintWriteCapability`, nem `bindWriteAuthority` são exportados por nenhuma entrada do pacote (`.`, `./ui`, `./dashboard`, `./jobs`). `createSocialPublisher` cria o adaptador por dentro; o publicador devolvido é um objeto congelado sem `createPost`, sem referência ao adaptador e sem construtor alcançável. Modo real: `createSocialPublisher({ mode: 'live', transport, liveAck, actor, flags, payloadMapper })` exige `liveAck`, ator `publisher_social` e flag `growth_linkedin_live` ligada (conferidos na criação e antes de CADA operação, dentro do adaptador); o transporte fica em campo `#` privado.
- **Escrita só com a capability do publicador:** `createPost`/`updatePost`/`deletePost` de todo adaptador exigem uma `WriteCapability` mintada e vinculada dentro de `createSocialPublisher`; sem ela, `WriteRefused` antes de qualquer efeito. Teste `src/__tests__/public-surface.test.ts` importa tudo o que o pacote exporta, varre o grafo de objetos alcançável (membros proibidos: `createPost`, `updatePost`, `deletePost`, `bindWriteAuthority`, `mintWriteCapability`, `transport`, `adapter`), segue os reexports dos 4 pontos de entrada e confere o `package.json`: não há caminho para escrever sem o publicador. Verificado por mutação (reexportar um módulo interno faz o teste falhar).
- Instagram e The Loyal: chave desligada ⇒ recusa registrada na auditoria, mesmo pela identidade de publicação.
- Sem imagem aprovada ou gates pendentes ⇒ bloqueia. Reenvio com a mesma chave não duplica.
- O dashboard só pede publicação **simulada** e recusa com adaptador real; regera o pacote e compara o hash do criativo (matéria mudou ⇒ 409).
- Criativo carrega `brandStatus` (brandkit está `approved`, mesma fonte do `@ln/ui`); qualquer status diferente de `approved` continua virando bloqueio de publicação REAL (`brandkit_<status>`).

## Não verificado / pendente
- Menção, edição, exclusão, PDF de carrossel e 7 dias sem sessão só se provam por escrita em página de teste (R5-02). Leitura do mLabs: ver `docs/mlabs-capabilities.md` §5 (fonte: PM).
- Job testado com Worker/Queue estruturais (fakes), sem Redis nem `bullmq` real; o gateway é simulado (o real é `packages/modelops`, ainda não mesclado).
- Sem rotas em `apps/web/app/api` nem páginas em `apps/web/app/studio` (donos: Backend e Studio): os handlers e os componentes estão prontos para serem importados; e2e de página fica com a frente dona da página.
- Handle verificado de Instagram (sem marcação no Instagram); texto do The Loyal não construído.
