# @ln/editorial — Frente 06, Fábrica editorial

Estado: **implementado em fixtures/MOCK; não homologado; não operacional.** Flags (`editorialCollector`, `editorialPipeline`, `instagram`, `theLoyal`) vêm de `@ln/contracts` e estão desligadas por padrão. Sem chamada a API tarifada: todo acesso a modelo passa pela porta `ModelGateway` (`src/gateway.ts`), cuja implementação real é de `packages/modelops`.

## Mapa
| Pasta | O que faz |
|---|---|
| `src/sources` | Registro de 40 fontes primárias pesquisadas (somente leitura, 22/11/2026) em `seed.ts`, com `verification` (nível lido/parcial/inacessível, robots, trecho dos termos, direitos de imagem). **Todas `enabled=false`, termos `pending`, URL `urlVerified=false`** até revisão do QA/responsável (J-14). Detalhe em `docs/fontes-verificacao.md`; dados brutos em `docs/fontes-pesquisa.json`. `eligibility()` só libera com `enabled` + termos `approved` + URL conferida + sem login/paywall + (host compartilhado ⇒ `pathPrefix`). |
| `src/collector` | Coletor determinístico (RSS/Atom/HTML), **sem LLM**: anti-SSRF a cada salto de redirecionamento, `robots.txt` (indisponível = não coleta), detecção de login/paywall (não ingere), saneamento de HTML e marcação de instruções embutidas como `suspicious`, evidência com URL + data + SHA-256. A rede entra pela porta `Fetcher`; o coletor resolve o DNS, exige que TODOS os IPs sejam públicos e entrega ao fetcher o IP validado (`http-fetcher.ts` conecta só nele, sem pool, sem seguir redirect), revalidando a cada salto (anti DNS rebinding). Respeita o `Crawl-delay` do robots.txt (espera entre requisições; acima de 120 s a fonte é pulada) e o limite por hora da fonte (`maxRequestsPerHour`). Hosts compartilhados (`www.gov.br/<órgão>`) são restritos por `pathPrefix`. |
| `src/dedupe` | URL canônica, hash do texto normalizado e similaridade lexical (Jaccard de shingles de 3 palavras, limiar 0,6), com clusters. Sem pgvector. |
| `src/rules` | Gates determinísticos: assinatura, nunca inventar fala/entrevista/apuração/métrica, claims com evidência, número e aspas verbatim, originalidade (≥8 palavras seguidas ou >30% de 5-gramas = `copy_literal`), atribuição com link, imagem só com base de direito (D08). |
| `src/pipeline` | Jobs BullMQ por estágio: `triage → context → draft → factcheck → review` (→ `article.approved`) e `social_pack` (só após `article.published`). Estado no job; bloqueio é resultado, não falha. `InMemoryQueue` para testes; `createBullmqPipeline` recebe o módulo `bullmq` injetado (sem dependência dura). |
| `src/api` | Handlers de API puros para o CMS do LN Studio: fila editorial, visão de revisão (gate recalculado), revisão humana, checagem, correções e direito de resposta (inclui intake público). RBAC por papel de `@ln/auth`, MFA, validação zod, envelope `ApiError` de `@ln/contracts`, auditoria. **Fontes** (`source-handlers.ts`): revisão humana (termos, URL, robots, paywall; revisor ≠ pesquisador) e habilitação separada, com revisão vencida se a definição da fonte mudar; nunca automático. Porta `EditorialStore` **assíncrona** (contrato em `docs/editorial-store-contract.md`; suíte de contrato em `@ln/editorial/testing` para o Backend rodar sobre PostgreSQL; `InMemoryEditorialStore` como referência) e `applyOutcome` para os hooks do worker. |
| `src/corrections` | Errata (WF08) e resposta/retificação (WF18): estados, aviso público datado, texto do requerente preservado com hash, caso jurídico escalado ao responsável, reconciliação de posts sociais, fecha só com entidades reconstruídas. |
| `fixtures/` | Tudo `MOCK` (empresa, fontes, gateway, matérias fictícios). |

## Invariantes (cobertas por teste)
- Assinatura sempre `Redação Loyalty News`, imposta pelo sistema; byline de pessoa e linguagem de entrevista/apuração própria são barradas.
- Citações entre aspas e números do texto precisam constar literalmente nas evidências citadas.
- Checagem de fatos em **provedor distinto** do redator: o pedido leva `excludeProviders`, e a resposta do mesmo provedor bloqueia (`cross_provider_check_failed`). Claim sem veredito `pass` bloqueia.
- O gate de revisão refaz as checagens determinísticas; não confia no estágio anterior.
- Redator até 3 tentativas com o feedback dos achados (`max_attempts` da política); depois bloqueia.
- Imagem: sem base de direito registrada (licença, autorização, domínio público, exceção validada) → **sem foto**; com base exige crédito e link; conceitual precisa de rótulo.
- Pacote social: sem menções (texto puro), UTM, números/citações só da matéria, `no_image` sinalizado quando não há foto; Instagram só com flag.
- Recusa do gateway (orçamento, kill switch, preço desconhecido, sem modelo habilitado) → `budget_blocked`; nada é publicado.

## Pendências e dependências (honestas)
1. **Fontes**: o QA/responsável revisa termos e URLs (J-14) antes de habilitar qualquer fonte. Licença gov.br CC BY-ND (sem derivações): uso por citação e link.
2. **`packages/modelops`**: implementar `ModelGateway` (degraus e reserva de ADR-015 usam o campo `workflow`: WF08/WF18/auditoria consomem a reserva). Tipos do domínio editorial (Draft, Evidence, Claim) ainda são locais; migrar para `@ln/contracts` com o Chief Architect.
3. **Persistência**: o estado do job viaja no payload; falta gravar artigo/evidência/auditoria no PostgreSQL (Backend/Data). `InMemoryAuditLog` é o contrato do registro interno.
4. **BullMQ real**: adaptador testado só com classes falsas; persistência/retentativa em Redis real fica para o DevOps/QA.
5. **Prazos legais** de retificação/resposta: não definidos aqui (R0-10, parecer pendente); `deadlineAt` é informado por quem abre o caso.
6. Verificação semântica de fatos depende do provedor distinto; as regras deterministas só provam o que é literal (aspas, números, cópia).

## Comandos (na raiz do monorepo)
`npm install` · `npm test` (vitest) · `npm run typecheck` · `npm run lint`.
