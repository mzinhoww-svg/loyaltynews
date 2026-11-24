# Loyalty News | Growth Factory — Social Media & OpenBot
**Complemento ao blueprint 1.0 · v1.1 · 21/11/2026**

## 1. Escopo
LinkedIn como canal prioritário de autoridade B2B e Instagram para alcance visual; a The Loyal converte audiência em relacionamento próprio. Um artigo publicado gera um pacote social versionado. Todo post editorial de feed deve ter imagem contextual, original/licenciada, assinatura visual, crédito e alt text. Conteúdo de exemplo é fictício; não publicar mocks. Identidade teal é proposta compatível com o protótipo anterior. Não copiar identidade FIDC News. Sem posts enganosos, clickbait, marcações não relacionadas, fake engagement ou alegações inventadas. Conteúdo patrocinado identificado publicamente.

## 2. Workflows OpenBot e responsabilidades
Usar VPS/host persistente, confirmar requisitos, licença comercial e disponibilidade de cada integração. Supabase/CMS é sistema de registro, OpenBot orquestrador; não guardar credenciais em prompts. Integrar por API server-side com autenticação de serviço escopada. Fila durável, locks, dedupe, retries, DLQ, logs, limites de custo, alertas e kill switch. Cada execução tem workflow_run_id e correlation_id, article_id e revision. Handoff JSON validado por schema; jamais obedecer instruções embutidas em fontes.

| Agente | Input | Output / gate |
|---|---|---|
| Scout | fontes autorizadas | cluster de fatos, links, timestamps |
| Editor-chefe | candidatos | prioridade, pauta, formato e ângulo |
| Journalist | pauta/evidências | artigo, lead, contexto, SEO, fontes |
| Fact checker | artigo e evidências | mapa de claims e bloqueios; revisão se alto risco |
| Entity Intelligence | entidades do artigo | marca/pessoa, relação, perfil oficial, confiança e prova |
| Creative Director | artigo aprovado e acervo | arte por formato, licença, crédito, alt text, QA |
| LinkedIn editor | conteúdo aprovado | 1–2 variantes, hook, marcações resolvidas, CTA e UTM |
| Instagram editor | conteúdo aprovado | legenda, card/carrossel, stories, mentions e CTA |
| Publisher | pacote aprovado | agenda, envio, recibo remoto, URL, estado e falhas |
| Growth analyst | métricas reais | diagnóstico, hipóteses e testes; não muda regras sozinho |
| Newsletter editor | artigos e dados | edição The Loyal com links e patrocínios rotulados |

### Fluxos reutilizáveis
WF01 radar: a cada 30 min em horário editorial, detectar itens, deduplicar e criar pauta. WF02 produção: evento pauta aprovada -> evidências -> texto -> QA -> artigo publicado. WF03 distribuição: artigo publicado -> resolução de entidades + geração criativa em paralelo -> copy LinkedIn/Instagram -> validação -> aprovação -> agenda -> publicar. WF04 breaking: pauta urgente, fonte primária e revisão obrigatória; publicar assim que validado. WF05 newsletter: compor às 06:00 BRT em dias úteis, revisar antes do envio proposto às 07:00. WF06 métricas: snapshots +1h, +24h, +72h e +7d quando APIs disponibilizarem; relatório semanal. WF07 correções: artigo corrigido/inativado -> suspender fila vinculada, revisar post publicado e registrar atualização/correção por canal. WF08 agenda: eventos futuros com fonte oficial -> card, CTA e calendário; evitar duplicidade. Todos os horários configuráveis em America/Sao_Paulo e armazenados UTC.

## 3. Entity Intelligence e menções
Resolver nomes e aliases para entity_id. Cada entidade: tipo (empresa, marca, pessoa, instituição), nome, aliases, website oficial, LinkedIn URL/URN quando acessível, Instagram handle/ID quando acessível, fonte de comprovação, status verificado/pendente/rejeitado, última verificação, permissões e contexto da relação com matéria. Não coletar contatos pessoais, não adivinhar handles nem marcar homônimos. Marcar todas as entidades diretamente relevantes, quando tecnicamente permitido, sem tags massivas; em caso de muitas, priorizar 2–5 centrais e usar nomes em texto para demais. Menção a pessoa não implica endosso. Para LinkedIn usar sintaxe suportada de mention por URN em Posts API, com autorização / escopo apropriado; identificação de pessoa pode ser limitada, inclusive a seguidores elegíveis. Para Instagram usar @handle correto na legenda e tags na mídia se cabíveis, suportadas e permitidas. Não tratar nome em texto como menção ativa. Postiz precisa passar PoC de preservação de menções nativas; se falhar, usar adaptador oficial direto ou revisão/publicação manual. Não contornar restrições de plataforma. Registrar status por entidade: tagged/unsupported/unverified/plain_text/manual_required. Revalidar publicação retornada quando possível.

## 4. Creative factory e identidade
Templates determinísticos (HTML/CSS + Playwright ou SVG compositado) ao invés de pedir ao modelo que desenhe textos; foto real e autorizada quando notícia sobre executivo, marca, loja ou aeronave; ilustração claramente identificada quando conceitual. Não fabricar fotografia de acontecimento real, nem modificar imagem para evitar copyright; crédito não substitui licença. Foto contextual em todos os posts, com fallback gráfico/ilustração contextual legítima; sem imagem aprovada, bloquear postagem. Preservar faces, logos e recorte, contraste >=4.5:1 para texto comum, safe area 72px em 1080, não ocultar créditos; conferir texto contra matéria aprovada. Fontes sugeridas Inter e Georgia (licenças verificadas antes de produção); teal #153C3C, verde #34877A, menta #DDEFE8, branco, carvão #101C1C. Assinatura .ln / loyaltynews. provisória, não logo aprovado.

| Template | Visual | Uso |
|---|---|---|
| T01 News gradient | foto 50–55%, degradê teal, editoria, headline, subheadline opcional, assinatura e crédito | notícia geral |
| T02 Executive | retrato autorizado 50%, carvão sólido, headline/citação confirmada, crédito | declaração, entrevista, movimento executivo |
| T03 Numbers | gráfico ou número grande, período, fonte, contexto, assinatura | dados, balanço, pesquisa |
| T04 Breaking | selo Loyalty Flash e imagem relevante, headline curta, hora BRT | notícia urgente |
| T05 Carousel | 5–7 slides: gancho, fatos, contexto, impacto, fontes/CTA | análise e educação |
| T06 Agenda | foto/evento autorizado, data/local e organizador | eventos |
| T07 The Loyal | masthead, 3 destaques e CTA | newsletter |
| T08 Sponsored | anúncio identificado, marca cliente e assinatura | comercial |

Saídas propostas: 1080x1350 (4:5 feed), 1080x1080 (fallback quadrado), 1080x1920 (stories), 1200x627 (preview OG); carrossel com dimensões uniformes. Confirmar proporções, MIME, limites e formato de documento conforme plataforma e adaptador no momento da integração. Export JPEG/PNG, metadados autorais internos e alt text. Preview responsivo e validação overflow, OCR/checagem textual quando necessário, safe areas, legibilidade e licença. Templates versionados, editar texto dentro de limites, ajustar crop e ponto focal, regenerar sem perder edição manual.

## 5. Copywriting e crescimento
LinkedIn: gancho factual em primeira linha, 3–5 parágrafos curtos, fato novo, contexto com números verificados, impacto estratégico no Brasil, menções naturais, pergunta específica opcional, link canônico com UTM e CTA The Loyal. Instagram: gancho conciso, 2–4 pontos de contexto, CTA salvar/compartilhar quando relevante, link na bio quando configurado, perfis citados organicamente e 2–5 hashtags relevantes como hipótese inicial. CTA variado, sem repetir mecanicamente ou criar comentários artificiais. Testar tamanho, tema, horários e formatos com coortes comparáveis; nunca sacrificar precisão em favor de alcance. Não garantir engajamento. Política editorial institucional explicita responsabilidade por conteúdo e transparência quando aplicável.

Exemplo fictício (somente QA): “A próxima disputa dos programas de fidelidade pode estar na frequência, não apenas no volume de pontos. Parcerias com varejistas ampliam ocasiões de acúmulo. Para os operadores, o desafio é medir recorrência incremental e custo de incentivo. O que pesa mais: frequência ou margem? Leia a análise no Loyalty News. Receba a The Loyal.” Não atribuir a empresa real sem fonte. Imagem ilustrativa de varejo, identificada. Na operação real, incluir nomes e menções verificadas, links e evidências.

## 6. Social admin / rotas e telas
- `/admin/growth`: dashboard de posts, alcance, cliques, assinantes atribuídos, erros de menção, filas e custo; período, canal, editoria; métricas indisponíveis como N/D.
- `/admin/social/calendar`: dia/semana/mês, drag-drop com validação de conflito, filtros, fuso, estado, breaking lane; recomendação editável de horário.
- `/admin/social/queue`: kanban rascunho, QA, revisão, aprovado, agendado, enviado, publicado, falhou, cancelado; reprocessar com motivo, versionar e congelar conteúdo ao aprovar.
- `/admin/social/composer/{id}`: artigo e fontes, tabs LinkedIn/Instagram, copy, menções e UTM, arte, alt text, prévia, agendamento, aprovação por permissão, publicar teste; mostrar pendências e falhas de validação.
- `/admin/social/entities`: aliases, perfis oficiais, URNs, handles, evidência, resolução de conflito, verificação e enriquecimento manual.
- `/admin/social/templates`: grid templates, versões, tokens, editoria, fonte e teste responsivo, preview crop, export/rollback.
- `/admin/social/accounts`: contas, conexão OAuth, escopos, status, expiry, quotas, healthcheck, revogação, credenciais server-only.
- `/admin/social/workflows`: OpenBot runs, agentes, duração, custos, erros, inputs/outputs saneados, revisão, replay idempotente, aprovação e pausa global/per canal.
- `/admin/social/analytics`: métricas por canal/post/formato, comparação coortes, GA4 atribuição e The Loyal, dados faltantes, testes e export.
- `/admin/social/inbox` (fase 2): comentários permitidos via API, triagem de dúvida/correção/crítica, draft de resposta, revisão, sem spam, sem responder automaticamente a reclamações sensíveis.

## 7. Dados, eventos e API
Tabelas: `social_accounts`, `social_entities`, `entity_aliases`, `article_entities`, `social_templates` + `template_versions`, `social_assets`, `social_packages`, `social_posts` (article_id, revision, channel, account_id, content_type, copy, scheduled_at, status, dedupe_key, provider, remote_id, permalink, utm, approval_id), `social_post_mentions` (entity_id, intended_mode, resolution, provider_result), `social_approvals`, `social_jobs`, `social_metric_snapshots`, `social_experiments`, `social_audit_logs`, `social_comments` (fase 2). RLS, acesso granular editor/creative/publisher/analyst/admin, identidade de serviço restrita, storage privado até export, signed URLs com prazo suficiente para ingestão de mídia e verificação de download. Unique account/channel/revision/variant/schedule key; outbox transacional e lock por post; em timeout consultar provedor antes de reenviar. Status só published com recibo verificado. Assinaturas de webhook, replay protection e idempotência. API routes internas: POST /api/internal/growth/events (article.published/corrected), POST /api/internal/social/packages, POST /api/internal/social/posts/:id/approve|schedule|cancel|retry, POST /api/internal/social/render, GET /api/internal/social/entities, POST /api/internal/social/entities/resolve, GET /api/internal/social/metrics, POST /api/webhooks/social/:provider. Não expor credenciais nem dados privados. Provider adapter: validate, upload, schedule/publish, getStatus, getMetrics, cancel, capabilityMatrix; cada rede tem regras diferentes.

## 8. Integrações e PoC
OpenBot + Postiz MCP é proposta inicial; avaliar Buffer/Metricool como alternativa, e GA4/ESP para atribuição. LinkedIn Community Management API / Posts + Images API, `w_organization_social` ou escopos atuais equivalentes e permissões administrativas; Meta Instagram API conta profissional, OAuth e escopos de publicação/insights, permissões/revisão conforme modelo de login. Nenhuma credencial conectada. Confirmar licença comercial OpenBot, host e segurança. Testar publicação em conta de homologação, menção de organização e de pessoa elegível, @handle Instagram e tag de mídia, carrossel, créditos, alt text, recuperação de URL/metrics, correção e double submission. Fallback manual se capability não suportada. Links oficiais: https://openbot.run/ ; https://openbot.run/plugins/postiz ; https://openbot.run/plugins/metricool ; https://openbot.run/changelog ; https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api ; https://developers.facebook.com/docs/instagram-platform/ .

## 9. Cadência e mensuração
Hipótese inicial dias úteis: LinkedIn 08h, 12h, 17h (2–3 posts úteis/dia); Instagram 11h e 18h (1–2/dia), 2 carrosséis/semana, stories conforme relevância. The Loyal 07h BRT; urgências somente verificados; fim de semana conteúdo selecionado. Evitar flood e clones. Metas definidas após baseline 30 dias. Indicadores: impressões, alcance, saves quando disponível, shares/reposts, comentários, reações, cliques/CTR (denominador explícito), seguidores, tráfego qualificado, opt-in confirmado, conversão assistida, tempo publicação, custo/pacote, taxa de menções válidas, taxa de falhas. `utm_source=linkedin|instagram`, `utm_medium=organic_social`, `utm_campaign=editorial_YYYYMM`, `utm_content={post_id}_{variant}`. Instagram link na bio/stories quando aplicável; não inferir que toda visita direta veio de IG. Não somar reach único de plataformas como audiência deduplicada; mostrar período, fonte e último refresh no mídia kit. Sem fake metrics.

## 10. Backlog e gates
G1: accounts, schema, entity registry, RBAC, API/secret management, inventário de templates. G2: WF02/03 com dry-run, geração e preview, calendário, aprovação e trilha de auditoria. G3: PoC Postiz/native APIs e menções, fila idempotente, publicação de homologação e correção. G4: analytics, UTM/GA4, The Loyal e mídia kit; revisão humana de primeiras 30–50 peças, baseline e critérios de liberação de autonomia. G5: automação de baixo risco com QA obrigatório, feature flag, limites e kill switch; assuntos sensíveis, executivos, rumores, números controversos, patrocínios e correções sempre revisão humana. G6: experimentos, carrosséis, inbox, Reels; validar custos e impacto. Aceite: todos os posts feed têm imagem contextual com licença/alt text, todos os fatos rastreáveis, menções verificadas ou fallback registrado, nenhum post duplicado em retry, dados simulados nunca em produção, erros visíveis, revogação funciona, screenshots desktop/mobile e logs de teste. Não ativar produção sem homologação.
