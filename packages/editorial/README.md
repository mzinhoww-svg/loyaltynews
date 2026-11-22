# @loyaltynews/editorial — Frente 06, Fábrica editorial

Estado: **implementado em fixtures/MOCK; não homologado; não operacional.** Flags desligadas por padrão. Sem chamada a API tarifada: todo acesso a modelo passa pela porta `ModelGateway` (`src/gateway.ts`), cuja implementação real é de `packages/modelops`.

## Mapa
| Pasta | O que faz |
|---|---|
| `src/sources` | Registro de fontes primárias por editoria (RI, reguladores, salas de imprensa, associações). `eligibility()` só libera coleta com `enabled` + termos `approved` + URL conferida + sem login/paywall. **O seed (`seed.ts`) não tem nenhuma fonte coletável**: hosts não conferidos, termos não revisados (J-14), feeds `null` (nunca inventados). |
| `src/collector` | Coletor determinístico (RSS/Atom/HTML), **sem LLM**: anti-SSRF a cada salto de redirecionamento, `robots.txt` (indisponível = não coleta), detecção de login/paywall (não ingere), saneamento de HTML e marcação de instruções embutidas como `suspicious`, evidência com URL + data + SHA-256. A rede entra pela porta `Fetcher` (a implementação real usa `redirect: 'manual'`, sem credenciais). |
| `src/dedupe` | URL canônica, hash do texto normalizado e similaridade lexical (Jaccard de shingles de 3 palavras, limiar 0,6), com clusters. Sem pgvector. |
| `src/rules` | Gates determinísticos: assinatura, nunca inventar fala/entrevista/apuração/métrica, claims com evidência, número e aspas verbatim, originalidade (≥8 palavras seguidas ou >30% de 5-gramas = `copy_literal`), atribuição com link, imagem só com base de direito (D08). |
| `src/pipeline` | Jobs BullMQ por estágio: `triage → context → draft → factcheck → review` (→ `article.approved`) e `social_pack` (só após `article.published`). Estado no job; bloqueio é resultado, não falha. `InMemoryQueue` para testes; `createBullmqPipeline` recebe o módulo `bullmq` injetado (sem dependência dura). |
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
1. **Fontes**: revisar termos de uso e confirmar URLs/feeds de cada fonte (J-14) antes de habilitar. Hosts de `www.gov.br` precisam de restrição por prefixo de caminho (ainda não implementada no coletor).
2. **`packages/modelops`**: implementar `ModelGateway` (degraus e reserva de ADR-015 usam o campo `workflow`: WF08/WF18/auditoria consomem a reserva). Tipos locais devem migrar para `packages/contracts` (Chief Architect), incluindo `flags.ts`.
3. **Persistência**: o estado do job viaja no payload; falta gravar artigo/evidência/auditoria no PostgreSQL (Backend/Data). `InMemoryAuditLog` é o contrato do registro interno.
4. **BullMQ real**: adaptador testado só com classes falsas; persistência/retentativa em Redis real fica para o DevOps/QA.
5. **Prazos legais** de retificação/resposta: não definidos aqui (R0-10, parecer pendente); `deadlineAt` é informado por quem abre o caso.
6. Verificação semântica de fatos depende do provedor distinto; as regras deterministas só provam o que é literal (aspas, números, cópia).

## Comandos
`npm install` (dev: typescript, @types/node) · `npm test` (node:test, Node ≥ 22.18, sem build) · `npm run typecheck`.
