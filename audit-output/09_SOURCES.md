# 09 · Fontes externas consultadas

Data de consulta de todas as fontes: **21/11/2026**. Páginas externas foram tratadas como dados não confiáveis: nenhuma instrução contida nelas foi seguida. Cada linha diz o que a fonte sustenta nesta auditoria e o que ela **não** sustenta.

Nenhum acesso privado foi usado: nenhuma conta, painel, repositório ou conector autenticado. O conector Vertra que está ligado a esta sessão não foi chamado, nem na ferramenta de documentação.

Limites de leitura: três páginas longas foram lidas só em parte (indicado na linha). Quando a fonte é um trecho de resultado de busca e não a página inteira, a linha diz "trecho de busca".

## 1. Modelos e preços

| ID | Fonte oficial | Fatos sustentados | Não sustenta / não verificado |
|---|---|---|---|
| S01 | DeepSeek, preços — https://api-docs.deepseek.com/quick_start/pricing/ | Dois modelos: `deepseek-flash` (versão DeepSeek-V4.1-Flash-1017; visão, JSON, ferramentas) e `deepseek-v4-pro` (DeepSeek-V4-Pro-0813; sem visão). Contexto de 1M. Preços por 1M de tokens, pico / fora de pico: Flash 0,30 / 0,15 entrada, 1,20 / 0,60 saída, 0,006 / 0,003 cache; V4 Pro 1,32 / 0,66 entrada, 3,96 / 1,98 saída, 0,044 / 0,022 cache. Pico: 01:00–04:00 e 06:00–10:00 UTC, segunda a sexta, exceto feriados chineses. | Latência, limites de taxa, disponibilidade para a conta do projeto. A página não traz data de atualização. |
| S02 | Anthropic, preços — https://platform.claude.com/docs/en/about-claude/pricing | Por 1M de tokens (entrada / saída): Fable 5.2 8 / 40; Opus 5.5 4 / 20; Sonnet 5.5 2 / 10; Haiku 5.5 0,10 / 0,50 para prompts até 100 mil tokens e 0,50 / 2,50 acima disso. Leitura de cache 0,20 (Fable, Opus), 0,10 (Sonnet), 0,01 (Haiku). Lote com 50% de desconto. Busca na web: US$ 10 por mil buscas. Residência `inference_geo: "us"` multiplica por 1,1. | Limites de taxa por nível de conta. |
| S03 | Anthropic, modelos — https://platform.claude.com/docs/en/about-claude/models/overview | IDs de API: `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`; contexto 1M, saída 128K; visão e uso de ferramentas em todos. O endpoint de listagem de modelos informa o ciclo de vida. | A página não declara disponibilidade geral nem cita saída estruturada; testar por modelo em T03. |
| S04 | OpenAI, referência de geração de imagem — https://developers.openai.com/api/reference/resources/images/methods/generate | `gpt-image-2.6-flare` e `gpt-image-2.6-sunburst` são valores aceitos em `model`. Formatos de saída png, webp, jpeg. `gpt-image-1` foi desligado em 23/10/2026. | Preço. |
| S05 | OpenAI, preços — https://developers.openai.com/api/docs/pricing (trecho de busca) | Modelos de imagem 2.6: US$ 8 por 1M de tokens de imagem de entrada, US$ 30 por 1M de saída, US$ 5 por 1M de texto de entrada. | Preço por imagem. |
| S06 | OpenAI, guia de geração de imagem — https://developers.openai.com/api/docs/guides/image-generation (trecho de busca) | O custo de saída é de US$ 30 por milhão de tokens faturáveis; há uma calculadora na página. | Valor unitário por tamanho e qualidade para a família 2.6. A auditoria usa **US$ 0,05 por imagem como premissa**, não como preço. |
| S30 | DeepSeek, política de privacidade — https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html (trecho de busca) | Os dados pessoais são coletados, processados e armazenados na República Popular da China. A política da plataforma aberta diz que o desenvolvedor é o controlador perante seus usuários finais. | Termos de retenção e de uso para treinamento na API; mecanismo de transferência internacional aceito pela ANPD. |

## 2. OpenBot e Postiz

| ID | Fonte oficial | Fatos sustentados | Não sustenta / não verificado |
|---|---|---|---|
| S07 | OpenBot, página inicial — https://openbot.run/ | Aplicativo de desktop que roda agentes em equipe no computador do usuário; código aberto para leitura sob PolyForm Noncommercial 1.0.0; uso comercial exige licença; oferta gerenciada para equipes; fluxos com gatilho agendado e passo de aprovação; provedores via Codex, Claude Code, Gemini e outros, pontos de extremidade compatíveis com OpenAI e modelos locais. Fabricante: Synthetify Labs, Polônia. | A página não menciona API, SDK ou execução programática externa. |
| S08 | OpenBot, termos — https://openbot.run/terms (atualizados em 20/11/2026) | Uso comercial requer Commercial License; Starter com um assento, Team a partir de dois; agentes não contam como assento; lei polonesa; servidores hospedados apagam dados 14 dias após o fim do plano; aviso de que, na prévia atual, agentes podem operar com acesso total ao sistema. | Preço da licença e texto do Commercial License Agreement. |
| S09 | OpenBot, guia de VPS — https://openbot.run/guides/install-openbot-vps | Requer Ubuntu 24.04 LTS de 64 bits, systemd e sudo; opção Docker exige Docker Engine e Compose, perfil seccomp fornecido e ajuste de memória compartilhada; acesso por SSH; backup deve incluir o volume inteiro (logins, banco, chaveiro); voltar a uma imagem antiga depois de migração não é rollback seguro. | Tamanho mínimo de máquina; execução em PaaS sem SSH. |
| S10 | OpenBot, plugin Postiz — https://openbot.run/plugins/postiz (fatos conferidos pela página em 10/11/2026) | O plugin usa o servidor MCP do Postiz; agenda, publica e lista posts; a ferramenta de agendamento pode publicar na hora conforme o modo de permissão; Postiz em nuvem a partir de US$ 29 por mês. | Preservação de menções nativas. |
| S11 | OpenBot, changelog — https://openbot.run/changelog (**lidos os primeiros 100 mil de 1,2 milhão de caracteres**) | Versão 0.75.0 em 20/11/2026; rotinas por webhook com segredo de assinatura; gatilhos agendados; cliente MCP com servidores próprios; modelo por agente; estimativa de custo só para alguns modelos; atualização após a qual versões antigas não abrem os dados. | Existência de API pública nas partes não lidas. |
| S23 | Postiz — https://postiz.com/ , https://github.com/gitroomhq/postiz-app , https://docs.postiz.com/public-api/introduction (trechos de busca) | Edição auto-hospedada sob AGPL-3.0; quem auto-hospeda cuida das aprovações de app em cada rede; API pública com limite de 90 requisições por hora na criação de posts (100 na nuvem). | Suporte a menções por URN no LinkedIn. |

## 3. Vertra Cloud

| ID | Fonte oficial | Fatos sustentados | Não sustenta / não verificado |
|---|---|---|---|
| S12 | Documentação — https://docs.vertracloud.app/ | Plataforma como serviço: deploy por GitHub ou zip em contêiner isolado; Node.js, Next.js e outros; PostgreSQL, MySQL, MongoDB e Redis gerenciados com TLS; blob compatível com S3; workspaces com papéis; CLI, MCP, SDKs e API REST. | Servidores com SSH, Docker Compose, rede privada, região. |
| S13 | Imagens Docker — https://vertracloud.app/docker-images | Imagem construída de Dockerfile (zip até 100 MB ou GitHub), linux/amd64; limites: Pro 2 imagens, Business 6, Enterprise 20; disco persistente em /app incluído nos snapshots; app roda como usuário 1000:1000; fora de /app só pastas temporárias aceitam escrita. | Modo privilegiado, seccomp, memória compartilhada, rede entre contêineres. |
| S14 | MCP oficial — https://github.com/vertracloud/mcp (**lidos 100 mil de 150 mil caracteres**) | Pacote `@vertracloud/mcp` e conector remoto; chaves com escopos por permissão (por exemplo `apps:read`, `apps:write`, `apps:delete`, `databases:credentials`); ferramentas de leitura e de mutação; ferramentas destrutivas executam sem etapa de confirmação; licença MIT. | Lista completa de ferramentas na parte não lida. |
| S15 | Planos e limites — https://docs.vertracloud.app/plans-and-limits.md | Preço mensal por memória, em reais: Pro 4 R$ 20,90 (4 GB), Pro 8 R$ 47,90 (8 GB), Business 12 R$ 59,90 (12 GB), Business 16 R$ 94,90, Business 24 R$ 139,90; pré-pago com descontos de 10, 15 e 25% em 3, 6 e 12 meses; backup diário de banco a partir do Pro 4 e de aplicação a partir do Business 12; 10 GB por app; SLA declarado de 99,99%. | Região do datacenter; política de suspensão. |
| S16 | Bancos — https://docs.vertracloud.app/databases.md | PostgreSQL 18 ou 17, Redis 8.2 ou 7.2; TLS com certificado de cliente obrigatório; host público `<id>.db.usa1.vertraweb.app`; snapshot baixável e restauração; extensões confiáveis (pg_trgm, pgcrypto, citext, uuid-ossp, hstore); pgvector, PostGIS e extensões de superusuário indisponíveis. | Rede privada, retenção, recuperação a um ponto no tempo, alta disponibilidade, persistência do Redis, pg_cron. |
| S17 | Aplicações — https://docs.vertracloud.app/applications.md | Dois tipos de app: site (porta HTTP) e bot (processo em segundo plano, serve para workers e cron); reinício automático com proteção contra laço de falhas; snapshots manuais; domínios próprios a partir do Starter 2 com SSL automático. | Health checks, deploy sem indisponibilidade, retenção de logs, distinção entre variável e segredo. |

## 4. Redes sociais e métricas

| ID | Fonte oficial | Fatos sustentados | Não sustenta / não verificado |
|---|---|---|---|
| S18 | LinkedIn, Posts API — https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api | Escopo `w_organization_social`; menção no formato `@[Nome](urn:li:organization:ID)` com correspondência exata de nome (organização: nome completo); orgânico aceita texto, imagem, vídeo, documento, artigo e multi-imagem; carrossel só patrocinado; edição de texto e exclusão suportadas; versão de API com data de fim. | Elegibilidade de menção a pessoas; texto alternativo; limites numéricos. |
| S19 | LinkedIn, análise de app — https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review (trecho de busca) | As APIs de gestão de comunidade só estão disponíveis a organizações legalmente registradas, para uso comercial; é preciso informar e-mail corporativo, nome legal, endereço, site e política de privacidade. | Prazo de análise. |
| S20 | LinkedIn, níveis de acesso — https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access e FAQ (trechos de busca) | Nível Development com restrição de chamadas; pedido de Standard em até doze meses, com gravação de tela; verificação da página da empresa como pré-requisito. | — |
| S21 | Instagram, publicação — https://developers.facebook.com/docs/instagram-platform/content-publishing | Conta profissional; permissões de publicação; só JPEG; mídia em servidor público no momento da publicação; carrossel até 10; `alt_text` em imagens desde 24/03/2025; limite de 100 posts por 24 h numa seção e 50 em outra. | Marcação de usuários e de local; qual dos dois limites vale. |
| S22 | GA4, relatório em tempo real — https://developers.google.com/analytics/devguides/reporting/data/v1/realtime-basics | Cobre do momento presente a 30 minutos atrás (60 em propriedades 360); subconjunto de dimensões e métricas; até dois intervalos de minutos. | Cotas. |
| S33 | mLabs, guia do LinkedIn pelo MCP — https://www.mlabs.com.br/?p=681628 (modificada em 10/11/2026; consultada na conciliação, lida por resumo da ferramenta de leitura) | Página de empresa e perfil pessoal funcionam quando conectados à conta mLabs. Pelo MCP, a IA cria rascunho no calendário, envia para aprovação no Workflow, agenda o post aprovado e lê os seguidores da página. Formatos: texto; imagem com texto alternativo de até 1.000 caracteres; vídeo; documento em PDF, Word ou PPT com título obrigatório de até 100 caracteres, que é onde entra o carrossel; enquete. Cada pessoa autoriza com o próprio login e as ações ficam registradas. Servidor em `https://mcp.mlabs.io/mcp`. | Publicar na hora, editar e excluir; menção a empresas ou pessoas; se a aprovação do Workflow é obrigatória; escopos de permissão; plano exigido e limites de uso. |
| S34 | mLabs, página do MCP — https://www.mlabs.com.br/funcionalidades/ia-mcp/ (consultada na conciliação, lida por resumo) | O MCP vem incluso na assinatura, sem custo adicional; assinatura a partir de R$ 29,90 por mês por marca no plano anual. Clientes citados: ChatGPT, Claude, Gemini, Perplexity, Manus e Copilot. A IA agenda posts, consulta relatórios, acompanha aprovações e responde mensagens. | Uso por servidor, sem interface de chat; forma de autenticação e validade da autorização; limites de uso; lista de redes atendidas pelo MCP. |

## 5. Normas brasileiras

Nada nesta seção é parecer jurídico. Todo ponto jurídico da auditoria precisa de revisão por profissional habilitado.

| ID | Fonte oficial | Fatos sustentados | Não sustenta / não verificado |
|---|---|---|---|
| S24 | Lei 9.610/1998 — https://www.planalto.gov.br/ccivil_03/leis/l9610.htm | Art. 7º I e VII (textos e fotografias protegidos); art. 8º (ideias, nomes e títulos isolados não são protegidos); art. 24 I e II; art. 29 I; art. 36; art. 46 I a (reprodução de notícia na imprensa com menção de autor e publicação), III e VIII; art. 47 (paráfrase); art. 79 §1º e §2º (crédito e integridade da fotografia). | Aplicação a um portal que reescreve notícias com modelos de linguagem; direito de imagem de pessoas. |
| S25 | LGPD, Lei 13.709/2018 — https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm e publicação no DOU (trechos de busca) | Art. 4º II a (a lei não se aplica a tratamento para fins exclusivamente jornalísticos); art. 7º §3º (dado de acesso público: finalidade, boa-fé e interesse público) e §4º (dado tornado manifestamente público pelo titular). | Enquadramento do produto Intelligence; prazos de resposta ao titular; regras da ANPD para agentes de pequeno porte; transferência internacional. |
| S26 | Lei 13.188/2015 — https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13188.htm ; Senado Notícias e AGU (trechos de busca) | Direito de resposta ou retificação em matéria de veículo de comunicação; exercício em 60 dias; publicação da resposta em até 7 dias segundo as páginas do Senado e da AGU. | Texto integral dos artigos sobre prazo de publicação. |
| S27 | CONAR, Código — https://www.conar.org.br/codigos (**lidos 100 mil de 176 mil caracteres**) | Art. 28 (o anúncio deve ser claramente distinguido como tal); art. 30 (peça jornalística veiculada mediante pagamento deve ser identificada). | Anexos e guias específicos. |
| S28 | PL 2338/2023 — https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=2487262 (trecho de busca) | Situação: aguardando parecer do relator na comissão especial da Câmara; apensações em novembro de 2026. | Conteúdo do texto e obrigações de rotulagem. |

## 6. Busca e produto

| ID | Fonte | Fatos sustentados | Não sustenta / não verificado |
|---|---|---|---|
| S29 | Google, conteúdo com IA generativa — https://developers.google.com/search/docs/fundamentals/using-gen-ai-content | Gerar muitas páginas sem agregar valor pode violar a política de spam; recomenda checar manualmente o conteúdo gerado e considerar informar como ele foi criado. | Efeito sobre este projeto em particular. |
| S31 | Busca exploratória de concorrentes (não oficial; trechos de busca): mundodomarketing.com.br, mercadoeconsumo.com.br, panrotas.com.br, gironews.com | Cobertura de fidelidade aparece em veículos de marketing, varejo e turismo; nenhum vertical B2B dedicado apareceu nessa busca. | Ausência de concorrente: uma busca não prova isso. |
| S32 | FIDC News, mídia kit — https://fidcnews.com.br/midia-kit (consultado na manhã de 21/11/2026, na primeira parte desta conversa; não reconsultado à tarde) | Tabela de referência: topo R$ 3.000/mês, sidebar R$ 1.750/mês, rodapé R$ 1.250/mês; 47 formatos; audiência declarada pelo próprio veículo de cerca de 31 mil visitas por mês e 22 mil seguidores no LinkedIn. | Auditoria independente desses números. |

## 7. Pontos não verificados e teste proposto

| Ponto | Por que importa | Teste | Onde |
|---|---|---|---|
| Região, rede privada, retenção de backup, PITR e persistência do Redis na Vertra | RPO/RTO e transferência internacional | Perguntas ao suporte e leitura do painel, somente leitura | T00-03 |
| Preço e cláusulas da licença comercial do OpenBot | Legalidade do uso | Cotação e leitura do contrato | antes de qualquer PoC |
| Execução programática do OpenBot (entrada, retorno, idempotência) | Viabilidade como runtime | PoC de oito testes (03_ARCHITECTURE_OPTIONS §3) | PoC opcional |
| Disponibilidade e limite de taxa de cada modelo para a conta | Roteamento real | Listagem de modelos e teste de fumaça por ID | T03 |
| Custo por imagem da família 2.6 | Rota de imagem bloqueada por custo desconhecido | Gerar 10 imagens e ler o uso | T03 |
| Menção a pessoas e texto alternativo na API do LinkedIn | Requisito de marcar entidades | Post de teste em página de homologação | T06 |
| Limite diário de publicação no Instagram | Agenda de posts | Consultar o endpoint de limite | T06 |
| Chromium sem root em contêiner Vertra | Renderizador | PoC de renderização | T01 |
| Better Auth, pg-boss, BullMQ com certificado de cliente | Escolhas de biblioteca | Leitura de documentação e teste | ADRs em T00/T01 |
| Base legal, prazos e transferência internacional na LGPD; direito de imagem | Bloqueio do produto de pessoas | Parecer de advogado | antes de T07 |
| Marca "Loyalty News" e "The Loyal" | Nome do produto | Busca de marca e de domínio | T00 |
| Câmbio usado no total indicativo (R$ 5,50 por dólar) | Só afeta a soma em reais | Trocar pela cotação oficial do dia | 04_cost_model |

## 8. Conciliação de 21/11/2026: fontes novas e pontos não verificados

As decisões do responsável (`11_CONCILIACAO.md`) trouxeram o mLabs para o lugar do Postiz. Duas páginas do fornecedor foram consultadas, S33 e S34. O conector do mLabs ligado a esta sessão não foi chamado: acesso privado depende de autorização separada.

Para a resposta oficial (`12_RESPOSTA_OFICIAL.md`) foi consultada mais uma fonte:

| ID | Fonte oficial | Fatos sustentados | Não sustenta / não verificado |
|---|---|---|---|
| S35 | Claude Code, documentação de MCP — https://code.claude.com/docs/en/mcp.md (**lidos os primeiros 100 mil de 151 mil caracteres**, por resumo da ferramenta de leitura) | Aceita servidor local por stdio. Três escopos de instalação: local, de projeto e de usuário; o de projeto fica em `.mcp.json` na raiz, pensado para ser versionado e compartilhado. Em sessão interativa o cliente pede aprovação antes de usar servidor de projeto; em execução não interativa os servidores de projeto carregam sem perguntar. Quando o mesmo nome existe em mais de um escopo, o local prevalece sobre o de projeto. O comando `/mcp` mostra o estado dos servidores. A página avisa que servidor que busca conteúdo externo expõe a risco de injeção de prompt. | O restante da página; permissões, hooks e subagentes, que ficam em outras páginas. |

| Ponto | Por que importa | Teste | Onde |
|---|---|---|---|
| Menção a empresas e pessoas no LinkedIn pelo mLabs | Requisito de marcar entidades; as páginas consultadas não tratam disso | Post de teste em página de homologação | R5-02, R5-03 |
| Publicar na hora, editar e excluir pelo mLabs; identificador do post publicado | Publicação só com recibo; correção propagada | Ciclo completo em página de teste | R5-02 |
| Uso do MCP do mLabs por serviço, sem interface de chat, com autorização que não expira | Publicação autônoma; as páginas descrevem o uso por aplicativos de IA com login de uma pessoa | Conectar a identidade de publicação e publicar por sete dias sem sessão interativa | R1-05, R5-02 |
| Preço de escrita em cache e taxa de acerto de cache nos provedores de modelo | Separa o teto do piso do custo de API depois da conciliação | Ler as páginas oficiais; medir com e sem cache | R0-08, R2-07 |
| Mecanismo do provedor do repositório para impedir que o executor altere a definição do verificador | Integridade do aceite autônomo | Tentativas recusadas e registradas | R0-03, R0-06 |
| Contexto real por turno no runtime de agentes | Maior fator de incerteza do custo | Medir no piloto de 50 peças | R4-14 |
| Como o teto de US$ 50 por mês é imposto no console de cada provedor de modelo | O teto precisa valer mesmo se o sistema falhar | Configurar e provocar o bloqueio com uma chave de teste | R0-01, R2-14 |
