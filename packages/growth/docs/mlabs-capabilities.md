# Capacidades do mLabs — validação somente por LEITURA (Frente 09)
Registro de 22/11/2026 (Integration Engineer). Nenhuma ferramenta de escrita foi chamada. Nada foi publicado, agendado, editado ou excluído.

## 1. O que foi verificado
| Verificação | Resultado | Como |
|---|---|---|
| Conector `mlabs` (https://mcp.mlabs.io/mcp) cadastrado, habilitado e com sessão | **ok** | `openbot.list_mcp_servers`: `signedIn: true` |
| Catálogo de ferramentas do conector | **ok: 105 ferramentas** | `openbot.test_mcp_server`: `status: ready`, `toolCount: 105` |
| Existem ferramentas de leitura para canais, limites, modelos, agenda, perfis, conta | **sim** (nomes abaixo) | catálogo do conector (nomes apenas) |
| Existem ferramentas de escrita para post, mídia, edição e exclusão | **sim** (nomes abaixo; **não chamadas**) | catálogo do conector |
| **Chamadas de leitura com resposta real** (`list_channels`, `get_post_limits`, `list_templates`, …) | **NÃO executadas** | O cliente MCP do mLabs não ficou utilizável nesta sessão (erro 429 / `CLIENT_HTTP_NOT_IMPLEMENTED` ao conectar as ferramentas), embora o teste de catálogo tenha respondido. Nenhuma resposta de conta foi lida. |

## 2. Catálogo relevante (nomes; sem invocação)
- **Leitura (permitidas na validação):** `list_channels`, `get_channel`, `list_profiles`, `get_profile`, `list_profile_groups`, `get_post_limits`, `list_templates`, `list_metrics`, `list_scheduled_posts`, `list_posts_by_date`, `get_post`, `get_account_settings`, `get_default_location`, `get_media_upload`, `get_post_notifications`, `list_workflows`, `get_workflow_options`.
- **Escrita (só a identidade de publicação, e só após o gate R5-02):** `create_post`, `update_post`, `delete_post`, `delete_published_post`, `bulk_delete_posts`, `restore_posts`, `toggle_post_status`, `upload_media`, `attach_media`, `prepare_media_upload`, `create_post_approval_link`, `send_chat_message` e as de workflow/contatos.
- Há também `search_social_users` (leitura): **indício** de busca de usuários para menção, **não prova** que `create_post` aceita menção.

## 3. Como completar a validação (pendente)
`validateMlabsReadOnly(transport)` (`src/mlabs/validate.ts`) roda o plano de leitura (`list_channels`, `get_post_limits`, `list_templates`, `list_profiles`, `get_account_settings`, `list_scheduled_posts`) através de `readOnlyTransport`, que **rejeita qualquer ferramenta fora da lista de leitura** (teste: `test/publisher.test.ts`, `test/validate.test.ts`). Guarda só a forma das respostas (tipo, tamanho, nomes de campo), nunca valores. Executar com um transporte MCP assim que o conector estiver utilizável e anexar o `ValidationReport` aqui.

## 4. O que leitura NÃO prova (fica para R5-02, em página de teste, com gate)
- menção a empresa/pessoa em texto de post;
- edição de post agendado; exclusão de post agendado/publicado;
- carrossel como documento (PDF) no LinkedIn;
- idempotência de `create_post` no lado do mLabs e uso sem sessão interativa por 7 dias.
Enquanto isso: menção só com identidade verificada **e** `mentionsSupported=true` (padrão `false` → texto puro); carrossel só como slides (SVG), PDF não montado; edição/exclusão reais não implementadas no adaptador real.
