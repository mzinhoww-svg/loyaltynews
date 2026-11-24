# R0-09 — Relatório de busca de marca e de domínio: "Loyalty News" (v2)
> **Cópia para o repositório público (rev. 2, Security, 24/11/2026):** nomes de pessoas físicas titulares de processos INPI (seções 2.1 e 2.2) omitidos; empresas, números de processo, classes e situações iguais ao original homologado pelo QA 4. A busca no pePI pelo número do processo mostra o titular a quem precisar.
**v2 (22/11/2026):** atende à revisão do QA (`qa/revisao-R0-09.md`): a consulta INPI foi refeita e a evidência bruta está em `raw/inpi/` (HTML, prints com data, detalhes de 20 processos, hashes); frases de conclusão limitadas à consulta e à data; classe 38 qualificada pela especificação; confirmações do QA incorporadas (§1). A v1 está em `raw/relatorio-marca-dominio-v1.md`.
Executor: LN Integration Engineer · Consultas em 22/11/2026 (v1: ≈17:45–18:05 BRT / 20:46–20:50 UTC; v2 INPI: 18:19–18:22 BRT) · Tarefa R0-09 (achado F-116) · Status: preparação, **não homologada**; aceite retroativo pelo verificador externo.
Nada foi registrado, comprado, reservado ou enviado. Só fontes públicas, sem login. Isto é triagem técnica, **não parecer jurídico** (ver R0-10).

## 0. Resumo (leia primeiro)
- **INPI:** a Pesquisa Básica (Exata e Radical, consulta anônima de 22/11/2026, base atualizada até 17/11/2026) **não retornou** pedido/registro com "LOYALTY NEWS", "LOYALTYNEWS", "LOYAL NEWS" ou "NEWS LOYALTY". Vale só para esses termos, essa busca e essa data; não é parecer de registrabilidade nem libera uso ou depósito. Evidência: `raw/inpi/`.
- **Conflito indireto: existe.** O elemento LOYALTY tem 109 processos; há registros em vigor em classe 35 (e 9/42) de titulares do setor de fidelização (ex.: LOYALTY, Linx Loyalty, IZ Loyalty, Cloud Loyalty, LoyaltyCom, Bonifiq Loyalty pendente). Em classe 38 só consta um registro antigo ("38:10", 1995) cuja especificação é "serviços de comunicação, publicidade e propaganda", de relevância baixa a verificar; em classe 41 só pedidos não relacionados a notícias (ver §2.3).
- **Registrabilidade:** "Loyalty" + "News" é descritivo para um veículo de notícias sobre fidelização. Risco de indeferimento por falta de distintividade (Lei 9.279/96, art. 124, VI) e de registro fraco. Avaliar com parecerista (R0-10).
- **Domínios:** `loyaltynews.com.br` consta **disponível** (RDAP 404 e, segundo o QA, a busca pública do Registro.br exibiu "Domínio disponível para registro"; situação do instante da consulta). `loyaltynews.news`: RDAP 404 do registro; disponibilidade comercial no registrador **não verificada**. `loyaltynews.com` (registrado em 2000), `loyaltynews.org` (2011, parking) e `loyalty-news.com` (2019) estão **ocupados**.
- **The Loyal (submarca citada em F-116):** `theloyal.com.br` foi registrado em 11/07/2026 e **já tem uma newsletter ativa "The Loyal | Pontos e milhas sem pegadinha"**; `theloyal.com` está à venda em corretor. Conflito de uso real no mesmo nicho. Em INPI, "THE LOYAL" só aparece em café (classe 30), indeferidos.
- **Perfis:** `x.com/LoyaltyNews` é ocupado por conta de notícias gerais (Nigéria, 23 seguidores). Instagram `@loyaltynews` aparece indisponível/inexistente, sem login. LinkedIn **não verificado** (exige login).
- **Registro de domínio e depósito de marca são atos do proprietário.** Nada foi feito.

## 1. Domínios (RDAP público, 22/11/2026 20:46–20:50 UTC)
Método: `GET https://rdap.registro.br/domain/<nome>` para `.br`; `GET https://rdap.org/domain/<nome>` (redireciona ao RDAP do registro) para demais. HTTP 404 = objeto não encontrado (não registrado). Respostas brutas em `raw/rdap-*.json`.

| Domínio | RDAP | Situação | Detalhes públicos (fonte: RDAP) |
|---|---|---|---|
| loyaltynews.com.br | 404 | **Não registrado** (aparente) | — |
| loyaltynews.news | 404 "Object not found" (Identity Digital) | **Não registrado** (aparente) | — |
| loyaltynews.com | 200 | **Ocupado** | Criado 11/04/2000; expira 11/04/2027; NS GREATDOMAINS.COM (indício de parking/venda); site não respondeu (HTTP 000) |
| loyaltynews.org | 200 | **Ocupado** | Criado 23/09/2011; expira 23/09/2027; NS domaincontrol.com; página de parking |
| loyalty-news.com | 200 | **Ocupado** | Criado 29/07/2019; expira 29/07/2027; NS IDP365.NET; site não respondeu (HTTP 000) |
| loyalty-news.com.br | 404 | Não registrado (aparente) | — |
| loyaltynews.net / .app / .io / .ai / .info / .media / .online | 404 | Não registrados (aparente) | — |
| loyaltynews.net.br / .jor.br / .br | 404 | Não registrados (aparente) | `.jor.br` e `.net.br` têm regras de elegibilidade no Registro.br — **não verificadas** |
| theloyal.com.br | 200 | **Ocupado** | Criado 11/07/2026; expira 11/07/2027; NS Vercel; site ativo: newsletter de pontos e milhas |
| theloyal.com | 200 | **Ocupado** | Criado 11/06/2011; redireciona a hugedomains.com (venda); consulta bloqueada por Cloudflare |
| theloyal.news | 404 | Não registrado (aparente) | — |

Limites: RDAP 404 não distingue "livre" de "reservado/bloqueado/em liberação" pelo registro; antes de agir, o proprietário deve confirmar na tela de disponibilidade do Registro.br e do registrador. Titulares estão ocultos (privacidade). Variações de domínio do blueprint: **o Blueprint v2.1 não lista nomes de domínio nem classes de marca** (só diz que a marca está "sujeita a busca e titularidade em R0-09"); por isso testei variações comuns, não as "do blueprint". Preço de registro, `.com.br` exigindo CNPJ/CPF no Registro.br e DNS/e-mail: não verificados.

## 2. INPI — busca de marcas (pePI, consulta anônima; v1 17:47–17:50 BRT, refeita na v2 às 18:19–18:22 BRT, 22/11/2026)
Fonte: https://busca.inpi.gov.br/pePI/ — Pesquisa Básica de marca, tipos Exata e Radical, 100 por página.
**Acesso anônimo (causa do "volta à entrada" relatado pelo QA):** o botão "Continuar...." da tela inicial não abre a pesquisa. O que funciona é abrir `.../pePI/servlet/LoginController?action=login` (cria a sessão anônima) e em seguida `.../pePI/jsp/marcas/Pesquisa_classe_basica.jsp`. Reproduzi assim no navegador do OpenBot e por HTTP com cookie de sessão; os resultados coincidiram nas duas vias (mesmos 109 processos para "loyalty"; "loyalty news" sem resultado).
**Evidência bruta (v2):** `raw/inpi/` — HTML dos resultados de cada termo (`inpi-*.html`), 2 páginas de "loyalty" (100+9), 20 páginas de detalhe `inpi-detalhe-<processo>.html` (situação, apresentação, apostila, especificação, titular), 2 prints com data/hora (`print-*.png`), `LEIA-ME.md` (método) e `SHA256SUMS.txt`. Base atualizada até 17/11/2026 (aviso do INPI na tela). O INPI avisa que o resultado da busca não garante registrabilidade.

### 2.1 Termos buscados
| Termo | Tipo | Resultado |
|---|---|---|
| "loyalty news" | Radical e Exata | Nenhum resultado |
| "loyaltynews" | Radical | Nenhum resultado |
| "loyal news" | Radical | Nenhum resultado |
| "news loyalty" | Radical | Nenhum resultado |
| "loyalty" | Radical | 109 processos (2 páginas; ver §2.2) |
| "the loyal" / "theloyal" | Radical | 2 processos: BARZILAI – THE LOYAL COFFEE BEAN (926908820) e Z THE LOYAL COFFEE BEAN (927173891), classe 30, ambos indeferidos, titular pessoa física (nome omitido) |
| "loyal" | Radical | 236 processos; só a página 1 (100) foi lida; **não verificado**: páginas 2–3 |

Reconfirmado na v2 com os HTML salvos: "loyalty news" (Radical e Exata), "loyaltynews", "loyal news", "news loyalty" → "Nenhum resultado"; "loyalty" → 109; "the loyal" → 2.

A busca não foi filtrada por classe (varre todas); as classes abaixo vêm dos resultados. Não consultei busca fonética nem por figura/logotipo, nem "Titular". Termos como "LN", "Loyal" sozinho (completo), "Fidelidade News" e grafias com erro: **não verificados**.

### 2.2 Marcas "LOYALTY" relevantes às classes 35/38/41/42 (e 9/36), com situação em 22/11/2026
Só os processos em vigor ou ainda em andamento; os arquivados, extintos e indeferidos foram lidos e omitidos aqui.
| Nº | Marca | Titular | Classe NCL | Situação |
|---|---|---|---|---|
| 826186149 | LOYALTY | Loyalty Assessoria e Consultoria Empresarial S/S Ltda | 35 | Registro em vigor |
| 822597918 | LOYALTY | Sumitomo Chemical Brasil Indústria Química S.A. | 35 | Registro em vigor |
| 818703008 | LOYALTY ESTRATEGIAS DE MARKETING | Loyal - Promo, Sports & Entertainment Ltda | 38 (antiga) | Registro em vigor |
| 830746528 | LTM LOYALTY&TRADE MANAGEMENT | Vertem Participações Empresariais S.A. | 35 | Registro em vigor |
| 823892069 | SMARTLOYALTY | Banco VR S/A | 35 | Registro em vigor |
| 840360657 / 840360665 | LOYALTYONE | LoyaltyOne, Co. | 35 | Registro em vigor |
| 907682928 / 907691820 / 907692303 | LINX LOYALTY | Linx Sistemas e Consultoria Ltda | 9 / 42 / 35 | Registro em vigor |
| 912815507 / 912815612 | CLOUD LOYALTY | Vantagens Serviços de Fidelização Ltda | 35 / 42 | Registro em vigor |
| 921660782 / 921660839 | IZ Loyalty | Izio Marketing Direto S.A. | 35 | Registro em vigor |
| 926260979 / 926261096 | LOYALTYCOM | Loyaltycom Serviços Ltda | 35 / 9 | Registro em vigor |
| 933027052 | Flash CRM Loyalty & Cashback | Flash Serviços Inteligentes de Tecnologia Ltda ME | 42 | Registro em vigor |
| 933683952 / 933684070 | Bee Loyalty | Omnibees Soluções em Tecnologia e Marketing Hoteleiro Ltda | 9 / 42 | Registro em vigor |
| 934775303 / 934775311 | LOYALTY CAPITAL | Loyalty Capital Ltda. | 35 / 36 | Registro em vigor |
| 936096195 | Loyalty7 | pessoa física (nome omitido) | 35 | Registro em vigor |
| 936335459 / 936335971 / 936336110 | ENTERPRISE LOYALTY PLATFORM GUPER | Guper Solução de Fidelidade Ltda | 9 / 42 / 35 | Registro em vigor |
| 944832695 | Bonifiq Loyalty | Bonifiq Desenvolvimento e Licenciamento Ltda | 35 | Aguardando prazo de oposição (depósito 14/08/2026) |
| 501573700 | L Founders of Loyalty | L – founders of loyalty Group B.V. | 35 | Registro em vigor (Madri) |
| 501717025 | UNLOYALTY PROGRAM | Expedia, Inc. | 35/39/43 | Registro em vigor (Madri) |
| 501807075 | LOYALTYQUEST | TCC Global N.V. | 9/35 | Parcialmente deferida, em recurso |
| 941255212 | Loyalty eventos | pessoa física (nome omitido) | **41** | Aguardando exame de mérito |
| 942494431 / 943219973 | LOYALTY BRAZILIAN JIU JITSU / LJ LOYALTY JIU-JITSU | Atos Curitiba Ltda / Centro de Treinamento Loyalty Jiujitsu | 41 | Aguardando exame de mérito (esporte; sem relação) |
| 840780699 | ALWAYS BELIEVE THE EXHIBIT STORIES … LOYALTY … | Simmetrico S.r.l. | 41 | Registro em vigor (frase longa; baixa relevância) |
| 938955888 | NEX.loyalty | empresário individual com nome de pessoa (nome omitido) | 45 | Registro em vigor |
| 501705950 | Global Loyalty Organisation | Global Loyalty Organisation | 35/41 | Designação definitivamente arquivada |

Os demais processos "LOYALTY" são de classes alheias (químicos, vestuário, cerveja, estética etc.) ou estão arquivados/extintos/indeferidos.

### 2.3 Leitura por classe
- **35 (publicidade, marketing, mídia kit):** mais povoada. Pela especificação nas páginas de detalhe (v2): LOYALTY 826186149 é marca **mista**, consultoria/assessoria empresarial, com apostila "sem direito ao uso exclusivo do elemento nominativo"; LOYALTY 822597918 (Sumitomo) tem especificação de herbicidas/inseticidas (sem afinidade aparente); LOYALTYONE 840360657 (programas de recompensa/publicidade, nominativa), IZ Loyalty 921660782 (marketing, programas de benefícios, mista), CLOUD LOYALTY 912815507 (administração de programa de incentivo, mista), LOYALTYCOM 926260979 (programas de fidelidade, publicidade, marketing; classe 35 **deferida**, com parte excluída) e Bonifiq Loyalty 944832695 (publicidade, marketing, programas de fidelidade; em prazo de oposição) são **afins a publicidade/marketing/fidelização** e devem ser examinados como possíveis anterioridades. Afinidade e risco de oposição dependem da especificação final do pedido da Loyalty News e não foram decididos aqui.
- **38 (telecom/difusão):** só consta LOYALTY ESTRATEGIAS DE MARKETING 818703008 (nominativa, em vigor, depósito 30/08/1995, classe antiga "38:10", especificação "serviços de comunicação, publicidade e propaganda", apostila "sem direito ao uso exclusivo de 'estratégias de marketing'", titular Loyal – Promo, Sports & Entertainment Ltda ME). Relevância para difusão de notícias: **a qualificar** em exame de especificação; não é classe 38 atual (Nice) de telecomunicações.
- **41 (publicação, notícias, eventos):** sem conflito com "NEWS". Há "Loyalty eventos" (941255212) em exame, que pode ser citado contra pedido de eventos/Agenda/Talks.
- **42 (software, plataforma):** LINX LOYALTY 907691820 (aluguel/desenvolvimento de software, nominativa), CLOUD LOYALTY 912815612 (software em nuvem para campanhas de incentivo, mista), Bee Loyalty 933684070 (segurança, bancos de dados e software; nominativa), ENTERPRISE LOYALTY PLATFORM GUPER 936335971 (PaaS/SaaS, mista) e Flash CRM Loyalty & Cashback 933027052 (software/CRM/IA, nominativa) em vigor: afins a software/plataforma; risco para o LN Studio se a marca for protegida em 42. Exame de especificação e de forma gráfica pendente.
- Classes 9 e 36 (apps, serviços financeiros) listadas só por contexto; o blueprint não as indica.

## 3. Perfis e homônimos (22/11/2026)
Método: navegação pública no navegador do OpenBot, sem login; busca web padrão.
| Plataforma | Endereço consultado | Resultado |
|---|---|---|
| X | x.com/loyaltynews | **Existe** "Loyalty News" @LoyaltyNews, Abuja (Nigéria), desde maio/2023, 23 seguidores, 19 posts de notícias gerais. Sem relação aparente com fidelidade; handle ocupado |
| Instagram | instagram.com/loyaltynews/ | "Perfil não está disponível" (sem login; indica inexistente ou removido; **não conclusivo**) |
| Instagram | instagram.com/theloyal.com.br/ | Idem; não é o @ real do The Loyal, que **não verificado** |
| LinkedIn | linkedin.com/company/loyaltynews e /loyalty-news | **Não verificado**: exige login (authwall). Fica para o proprietário ou para tarefa com sessão |
| Web | busca "Loyalty News" + fidelidade/Brasil | Sem veículo brasileiro com esse nome nos resultados. Existem homônimos genéricos: "Loyalty NewsWire" (The Wise Marketer, EUA, semanal), "Travel Loyalty News" (tag da Skift) |
| Web | "The Loyal" + pontos e milhas | A busca não achou o The Loyal; o site theloyal.com.br foi lido direto e está ativo (§1) |
Limite: a busca web é de resultados parciais (só EUA, uma consulta por tema); não substitui varredura exaustiva de redes e de Google Brasil.

## 4. Recomendação e riscos
1. **Nome "Loyalty News": triagem sem coincidência idêntica reportada, com riscos de distintividade e de anterioridade a examinar.** Não há pedido idêntico na busca de 22/11/2026, mas o sinal pode ser descritivo para publicação editorial sobre fidelização (art. 124, VI, Lei 9.279/96; a análise depende dos serviços e do conjunto apresentado, inclusive forma distintiva) e há marcas LOYALTY afins em 35/42. Isto não autoriza uso nem depósito. Levar a R0-10 para parecer sobre distintividade e sobre as classes 35/41/42.
2. **Domínio:** o proprietário deve garantir, por ato próprio, `loyaltynews.com.br` (principal para o Brasil) e, se desejar, `loyaltynews.news`. `loyaltynews.com` e `loyalty-news.com` estão ocupados: avaliar compra/negociação só com autorização do proprietário (custo não pesquisado; possível sobrepreço). Risco: alguém registrar os livres antes; o RDAP é um retrato de 22/11/2026.
3. **Depósito de marca (ato do proprietário):** priorizar classe 41 (notícias/publicação) e 35 (publicidade/mídia kit); classe 42 só se houver software próprio com a marca. Considerar mista (logo). Esperar parecer R0-10.
4. **The Loyal:** não usar como nome de submarca sem decisão do proprietário. O domínio `.com.br` já tem dono e newsletter no mesmo nicho (pontos e milhas); risco de confusão e de reclamação. Alternativa: renomear a submarca. O INPI não mostra barreira para classe 41, mas o conflito é de mercado/uso.
5. **Perfis:** reservar handles livres só por ato do proprietário. O X @LoyaltyNews está tomado; sugerir variação (ex.: @loyaltynewsbr), **não verificada**. Verificar LinkedIn com sessão do proprietário.
6. **Prazos externos (F-116):** depósito INPI e exame levam meses (prazo não verificado nesta consulta); registrar a data de cada pedido como bloqueio explícito do lançamento, conforme F-116.

## 5. Critério R0-09 — "Conflito de marca registrado ou ausente"
- Conflito idêntico ("LOYALTY NEWS"): **não reportado** pela Pesquisa Básica do INPI em 22/11/2026 (dados até 17/11/2026), com evidência bruta em `raw/inpi/`; limitado a esses termos e a essa consulta.
- Conflitos parciais: **registrados** (§2.2). Risco de descritividade: **registrado** (§4).
- Conflito de domínio/uso para "The Loyal": **registrado** (§1, §4).

## 6. Não verificado / limites
- Consulta ao MCP `loyalty-governance` (gov_get_task, dependências, critérios): **falhou** (conexão fechada); usei apenas `prompts/R0-09.md` e o Blueprint. R0-01 (dependência) não confirmada.
- Busca fonética/figurativa no INPI (feitas só buscas por texto; detalhes lidos de 20 processos, não dos 109), busca por titular, "loyal" além da página 1, e bases fora do INPI (EUIPO/WIPO/USPTO): não feitas.
- LinkedIn; perfil real do The Loyal no Instagram/LinkedIn; conteúdo de `loyaltynews.com` e `loyalty-news.com` (sem resposta HTTP).
- Disponibilidade real pela tela do Registro.br; preços; requisitos de elegibilidade `.jor.br`/`.net.br`.
- Resultados são retrato de 22/11/2026; repetir antes de qualquer registro.

## 7. Arquivos
- Este relatório (v2); v1 em `raw/relatorio-marca-dominio-v1.md`; respostas RDAP e páginas iniciais em `raw/` (`rdap-*.json`, `home-*.html`, `data-consulta.txt`); evidência INPI em `raw/inpi/` (ver `LEIA-ME.md` e `SHA256SUMS.txt`). Nenhum segredo, nenhuma credencial; consulta anônima, sem formulário de depósito.
