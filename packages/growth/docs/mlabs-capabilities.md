# Capacidades do mLabs — validação somente por LEITURA (Frente 09)
Registro de 22/11/2026 (Integration Engineer). Nenhuma ferramenta de escrita foi chamada. Nada foi publicado, agendado, editado ou excluído.

## 1. O que foi verificado
| Verificação | Resultado | Como |
|---|---|---|
| Conector `mlabs` (https://mcp.mlabs.io/mcp) cadastrado, habilitado e com sessão | **ok** | `openbot.list_mcp_servers`: `signedIn: true` |
| Catálogo de ferramentas do conector | **ok: 105 ferramentas** | `openbot.test_mcp_server`: `status: ready`, `toolCount: 105` |
| Existem ferramentas de leitura para canais, limites, modelos, agenda, perfis, conta | **sim** (nomes abaixo) | catálogo do conector (nomes apenas) |
| Existem ferramentas de escrita para post, mídia, edição e exclusão | **sim** (nomes abaixo; **não chamadas**) | catálogo do conector |
| **Chamadas de leitura com resposta real** (`list_channels`, `get_post_limits`, `list_templates`, …) | **Executadas pelo Program Manager** (fonte: PM, 22/11/2026; ver §5) | O cliente MCP do Integration Engineer falhou (erro 429 / `CLIENT_HTTP_NOT_IMPLEMENTED`); o PM fez as leituras pela conexão dele. Arquivo: `fast-track/mlabs-leitura-2026-11-22.md`. Não repeti as consultas. |

## 2. Catálogo relevante (nomes; sem invocação)
- **Leitura (permitidas na validação):** `list_channels`, `get_channel`, `list_profiles`, `get_profile`, `list_profile_groups`, `get_post_limits`, `list_templates`, `list_metrics`, `list_scheduled_posts`, `list_posts_by_date`, `get_post`, `get_account_settings`, `get_default_location`, `get_media_upload`, `get_post_notifications`, `list_workflows`, `get_workflow_options`.
- **Escrita (só a identidade de publicação, e só após o gate R5-02):** `create_post`, `update_post`, `delete_post`, `delete_published_post`, `bulk_delete_posts`, `restore_posts`, `toggle_post_status`, `upload_media`, `attach_media`, `prepare_media_upload`, `create_post_approval_link`, `send_chat_message` e as de workflow/contatos.
- Há também `search_social_users` (leitura): **indício** de busca de usuários para menção, **não prova** que `create_post` aceita menção.

## 3. Como repetir a validação por código
`validateMlabsReadOnly(transport)` (`src/mlabs/validate.ts`) roda o plano de leitura (`list_channels`, `get_post_limits`, `list_templates`, `list_profiles`, `get_account_settings`, `list_scheduled_posts`) através de `readOnlyTransport`, que **rejeita qualquer ferramenta fora da lista de leitura** (teste: `test/publisher.test.ts`, `test/validate.test.ts`). Guarda só a forma das respostas (tipo, tamanho, nomes de campo), nunca valores. Pode ser executado com qualquer transporte MCP utilizável para repetir ou atualizar o resultado do §5.

## 4. O que leitura NÃO prova (fica para R5-02, em página de teste, com gate)
- menção a empresa/pessoa em texto de post;
- edição de post agendado; exclusão de post agendado/publicado;
- carrossel como documento (PDF) no LinkedIn;
- idempotência de `create_post` no lado do mLabs e uso sem sessão interativa por 7 dias.
Enquanto isso: menção só com identidade verificada **e** `mentionsSupported=true` (padrão `false` → texto puro); carrossel só como slides (SVG), PDF não montado; edição/exclusão reais não implementadas no adaptador real.

## 5. Resultado da validação de leitura (fonte: Program Manager, 22/11/2026)
Origem: `C:\Users\mazin\OpenBot\Shared\loyalty-news\fast-track\mlabs-leitura-2026-11-22.md`. Só ferramentas de leitura; nenhuma escrita, agendamento ou publicação. Relato do PM, não verificado de forma independente por mim; os IDs de perfil e de canal ficam só no arquivo do PM.

| Ferramenta | Resultado informado |
|---|---|
| `list_profiles` | 1 perfil ("Novo Perfil"), ativo, com o canal LinkedIn conectado |
| `list_channels` (do perfil) | 1 canal: "Loyalty News", rede `linkedin`, ativo |
| `get_post_limits` (do perfil) | `monthly_limit` nulo (limite mensal não informado); 0 agendamentos no mês |
| `list_templates` | 0 itens (sem templates de Analytics) |
| `list_published_posts` (2026-01-01 a 2026-11-22) | 0 posts ("Nenhum conteúdo encontrado no período") |
| `get_account_settings` | plano "unknown"; produtos chat e social; fuso America/Sao_Paulo |

Conclusão registrada: existe um canal LinkedIn "Loyalty News" ativo, sem posts publicados nem agendados e sem limite mensal informado. Efeito no código: nenhum (o adaptador real segue sem mapeamento de escrita). Permanecem não provados por leitura (R5-02): menção, edição, exclusão, carrossel/PDF, idempotência no mLabs e 7 dias sem sessão interativa.

## 6. Rascunho e aprovação no mLabs: verificação DOCUMENTAL (23/11/2026, só leitura de esquemas)
Método: li as descrições e os esquemas de entrada das ferramentas do conector (`create_post`, `update_post`, `create_post_approval_link`, `create_workflow`, `send_workflow_to_approval`, `get_workflow_options`, `get_post_limits`, `toggle_post_status`). **Nenhuma ferramenta foi chamada** (nem leitura): ler o esquema não toca a conta. Isto prova o que a ferramenta **documenta**, não o que ela **faz**; o comportamento só se confirma em R5-02, em página de teste.

| Capacidade | O que o esquema documenta | Efeito no código |
|---|---|---|
| **Rascunho** | `create_post` aceita `status: "draft"` ("rascunho, status 9, não agenda"); sem `scheduledAt` vira rascunho; `update_post` informa que rascunho "continua rascunho" ao mudar a data e que **efetivar** o rascunho é abrir `scheduleLink` na mLabs (a ferramenta não promove rascunho a agendado) | `linkedinDraftMapper` (`src/mlabs/create-post-draft.ts`): só `status: "draft"`, nunca `scheduled`/`pending_approval`/`scheduledAt` (testado) |
| **Aprovação por link** | `status: "pending_approval"` (status 10, "não publica", exige `scheduledAt` futuro) + `create_post_approval_link` (link público para o aprovador; **não envia e-mail**; só quando o usuário pede aprovação por link) | **Não usado.** Quem aprova é o proprietário, na mLabs; sem decisão dele, nada de `pending_approval` |
| **Aprovação por Workflow** | `create_workflow`/`send_workflow_to_approval`: demanda no board, com criadores e aprovadores; o texto de `create_post` manda **não** usar as ferramentas de Workflow para aprovação por link | **Não usado** (outro fluxo, exige colaboradores) |
| **Idempotência** | `requestId` (16–128 caracteres `[a-zA-Z0-9_-]`): reutilizar nas tentativas; sem ele, pedidos idênticos da mesma pessoa reutilizam o resultado por **24 h enquanto o post existir** | `requestIdFor(idempotencyKey)`: derivado por hash, determinístico |
| **Documento (carrossel em PDF)** | LinkedIn (`linkedin`/`linkedin_personal`) aceita PDF/Word/PPT via `documentIds` (de `upload_media`), com `documentTitles` obrigatório (≤ 100); `urlData` e mídia são exclusivos (XOR) no LinkedIn | mapeado (`documentIds` + título); a montagem do PDF não existe ainda (hoje só slides em SVG) |
| **Menção no LinkedIn** | **Não há campo.** `mentions` do `create_post` é people-tag de Instagram (`instagram`, `instagram_reels`, `instagram_stories`); `search_social_users` serve ao Instagram/collabs | confirma o fallback: **texto puro** no LinkedIn; o mapeador recusa menção |
| **Edição** | `update_post` edita post agendado (legenda, mídia, data); "posts já publicados não podem ser editados" | adaptador real ainda recusa (sem teste de escrita) |
| **Exclusão** | existem `delete_post` e `delete_published_post` (esquemas não carregados por mim) | adaptador real ainda recusa |
| **Mídia** | `upload_media` (referência do cliente ou URL HTTP(S)) ou `attach_media` (link para o usuário anexar); consultar `get_media_upload` antes de criar o post | o mapeador exige upload concluído por `imageRef` (sem upload, recusa) |
| **Limites** | `get_post_limits` devolve limites de agendamento da conta (leitura do PM: `monthly_limit` nulo) | — |

**Não verificado (continua pendente para R5-02, em página de teste):** se o rascunho realmente aparece no LinkedIn do mLabs sem agendar nem publicar; o formato exato da resposta de `create_post` (o mapeador procura `scheduleId` e **recusa** se não achar); `requestId` na prática; documento/PDF de ponta a ponta; exclusão de rascunho; o que acontece com rascunho velho. **Decisão do proprietário:** rascunho no mLabs só será criado depois do gate R5-02; até lá, "rascunho" = modo simulado.

## 7. Modos do adaptador mLabs (LinkedIn)
- **Simulado (único modo ativo):** `createSocialPublisher({ mode: 'simulated' })`. Nada sai do processo; recibos `SIM-…`. Testado.
- **Real:** `createSocialPublisher({ mode: 'live', … })` exige confirmação explícita, ator `publisher_social` e a flag `growth_linkedin_live`; só funciona com `payloadMapper` (use `linkedinDraftMapper`, que é só rascunho); edição e exclusão reais recusam. Testado com transporte falso; **nunca chamado no mLabs**.

## 8. Métricas do canal LinkedIn (SOMENTE LEITURA) e envio de mídia (23/11/2026)
**Métricas** (`src/metrics/mlabs-metrics.ts`, `createMlabsMetricsSource`): lê `list_profiles` → `list_channels` (descobre o canal LinkedIn ativo; se houver zero ou mais de um, fica `indisponivel` e não escolhe sozinho), `list_published_posts` (páginas de 100, `nextCursor` e `responsePage`) e `get_follower_growth`. As duas ferramentas entraram na lista de leitura (`READ_ONLY_TOOLS`); o leitor só usa `readOnlyTransport`. Ligado ao resumo do Social Dashboard por `DashboardDeps.metrics` (opcional; sem fonte, o painel continua dizendo "indisponível").
- **Observado em leitura real (23/11/2026, 1 chamada de cada, só leitura):** perfil "Novo Perfil" ativo com canal LinkedIn "Loyalty News"; `list_published_posts` (90 dias) → `{posts: [], totalCount: 0, hasMore: false, message}`; `get_follower_growth` → `status: ok`, 1 observação (2026-11-22), 0 seguidores, crescimento 0. São zeros observados, não falta de dado.
- **NÃO verificado:** os nomes dos campos de cada post publicado (a conta não tem posts). O mapeamento é defensivo (`mapPublishedPost`): o que não for achado fica `null`, nunca 0; totais só quando todos os posts trazem o campo. Conferir com o primeiro post real depois da homologação.
- Regras: cada leitura traz período, origem `mlabs`, `fetchedAt`; falha vira `indisponivel` com motivo curto (`leitura_falhou`, `resposta_inesperada`, `canal_linkedin_*`), sem repassar o texto do erro; falha não entra no cache (TTL de 5 min com relógio injetado).

**Envio de mídia** (R5-02, decisão do PM de 23/11/2026: transporte real DENTRO do publicador, desligado atrás da flag `linkedinPublicacao`, só testado contra portas simuladas). Caminho: `publisher.uploadMedia(PUBLISHER_SOCIAL, creative, imageRef)` → rasterizador do UI/UX (`rasterizeCreative`, injetado em `media.rasterizer`: usa sharp e por isso não entra no índice) → `prepare_media_upload` (tamanho EXATO, sha256, canais) → PUT na `uploadUrl` com TODOS os cabeçalhos devolvidos (autorização de 10 min) → `get_media_upload` até `completed` → `imageId` que o `linkedinDraftMapper` põe no `create_post` (sempre `draft`).
- **Onde mora:** `uploadMedia` é método do publicador (mesma identidade `publisher_social`, mesma flag lida a cada operação, mesma capability de escrita do `publish`; auditado como `upload_media`). O transporte real é `mlabs/media-port.internal.ts` (interno, fora do índice); só `createSocialPublisher` o obtém, via `adapter.mediaUploadPort(cap)`. Não existe outro caminho para chamar `prepare_media_upload` (ferramenta de ESCRITA, fora de `READ_ONLY_TOOLS`).
- **Defesas:** não confia no rasterizador (recalcula PNG, dimensões, hash dos bytes, hash do SVG de origem, nome, limite de 5 MB conservador); criativo `mock` nunca sobe no modo real; a URL assinada só vale se for HTTPS público (sem credencial, localhost, IP literal ou nome sem ponto) e o método só PUT; o PUT padrão (`fetch`) não segue redirecionamento e tem prazo de 30 s; a URL assinada nunca entra em erro, auditoria ou log; a flag é conferida antes do preparo, do PUT e de cada consulta. Idempotência pelo `svgSha256` (registro `UploadLedger`; em produção precisa ser durável).
- **Nada foi chamado no mLabs real** (nem de mídia). **NÃO verificado:** a forma das respostas de `prepare_media_upload` e `get_media_upload` (leitura defensiva; fora do esperado vira recusa), o limite de tamanho do LinkedIn no mLabs, e se o `imageId` vem em `media.imageId`. Conferir em página de teste só depois da aprovação do proprietário no go-live.
- **Pipeline:** `LiveDraftConfig` agora recebe `rasterizer` (e `putBytes`/`uploadLedger` opcionais) no lugar do antigo `uploader`; o pacote e o pipeline do LinkedIn usam `renderSocialCard` (texto em curvas) em vez de `renderPost`. `tipoConteudo: 'analise'` vira o card de análise com selo de autoral; autoral + patrocinado é recusado (`regra_de_criativo`). O Instagram segue com `renderPost` (formatos vertical/story; flag desligada).
