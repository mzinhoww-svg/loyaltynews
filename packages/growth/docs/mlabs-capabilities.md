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
