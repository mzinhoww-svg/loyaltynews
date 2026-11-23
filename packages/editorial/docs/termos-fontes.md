# Dossiê de termos de uso das fontes candidatas (R0-10) — Frente 06

Preparado para a decisão do proprietário. **Não é parecer jurídico e não concede nem nega autorização**: registra o que o TEXTO OFICIAL de cada site diz, o que não diz e o que não foi possível ler. Onde há interpretação de lei (ex.: se reescrever fatos é "obra derivada"; se o portal comercial cabe em "sem fins lucrativos"), o dossiê aponta o ponto e deixa para o parecerista (R0-10).

Consulta: 23/11/2026 (horários aproximados dentro da sessão). Fontes: as 40 pesquisadas em `docs/fontes-verificacao.md` + as fontes públicas das 20 organizações da carga do Intelligence (`packages/intelligence/data/seed.public.v2.json`: Livelo, Bradesco, LATAM Pass, ABEMF e Dotz).

## Como foi lido (limites)
- **Quem leu:** a leitura dos documentos foi feita por leitores automatizados (3 agentes de pesquisa) com a ferramenta de leitura de páginas, que devolve texto resumido. Eu NÃO li cada página pessoalmente. Para não depender do resumo, **conferi cada trecho citado contra o HTML bruto da página** (uma leitura por documento, sem contornar nenhum bloqueio): ✓ = o trecho existe literalmente no texto bruto; ✗ = não confere; ◐ = parte confere; — = trecho curto demais para conferir. Dos 135 trechos, 133 conferem; os 2 restantes estão marcados abaixo (não conferem, parciais, curtos demais ou em página não verificável).
- Páginas que só carregam por JavaScript, PDFs e respostas 403 **não puderam ser conferidas** e aparecem como tal. Nada foi deduzido do que não foi lido.
- **Releitura dos 403 (23/11):** os 403 da primeira leitura vinham, em boa parte, do cliente genérico dos leitores. Com um User-Agent identificado ("LoyaltyNewsSourceVerifier/1.0 — verificação pontual de fonte pública; sem coleta em massa", uma leitura por URL, sem contornar nada), Livelo, LATAM, LATAM Pass, Magalu RI, Itaú e Santander passaram a responder 200 e foram relidos (lote 4). Resultado da releitura: Livelo, Magalu (RI) e Santander (RI) → classe D (sem termos de conteúdo); Itaú → classe C (item 8); **LATAM e LATAM Pass respondem 200, mas o termo só renderiza por JavaScript: seguem classe E (nada lido)**. Seguem bloqueados, e NÃO foram contornados: a home do Magalu (www), Star Alliance e ICO. BCB: a home responde 200 mas é JavaScript; termo oficial não lido.
- Termos mudam. Cada trecho vale para a data da consulta; qualquer habilitação deve reabrir a página (a revisão humana da fonte no Studio já é o ponto para isso).

## Uso que o portal pretende fazer (é contra isso que se lê cada termo)
1. **Coleta automatizada** de páginas públicas (respeitando `robots.txt`, sem login/paywall, com limite de ritmo).
2. **Reescrita dos fatos com palavras próprias**, assinatura institucional, **citando a fonte com link**.
3. **Trecho literal curto** (até 500 caracteres) guardado como evidência interna (e, na carga do Intelligence, como citação que sustenta cada vínculo).
4. **Sem imagens de terceiros** sem base de direito registrada (D08). O portal é comercial (publicidade).

## Critério de classificação (mecânico, igual para todos)
| Classe | Quando | Recomendação operacional |
|---|---|---|
| **A** — reuso autorizado no texto | o texto oficial lido autoriza expressamente reproduzir/reutilizar, com condições (atribuição, não distorcer) | candidata a habilitar (decisão do proprietário + revisão humana da fonte) |
| **B** — licença com restrição | licença aberta com restrição que pode alcançar a nossa reescrita (ex.: CC BY-ND) | NÃO habilitar até parecer (R0-10) |
| **C** — texto proíbe ou condiciona | o texto oficial lido proíbe ou condiciona reprodução, extração ou acesso automatizado à autorização | NÃO habilitar; caminho: autorização escrita do titular |
| **D** — sem termos de conteúdo | nenhum termo de uso de conteúdo localizado (só rodapé "direitos reservados" e/ou privacidade) | NÃO habilitar até haver autorização do titular (nada no site autoriza o reuso) |
| **E** — inacessível / não lido | 403 ou desafio de bloqueio, página que só renderiza por JavaScript, ou termo oficial não localizado: nada lido | NÃO habilitar até leitura manual dos termos (leitura manual no navegador) |

## Resumo para decisão
Domínios: 35. Com termos lidos e classificados (A–D): 31 — **3 com reuso autorizado no texto (Senado, Câmara, EDPB)**; 1 com licença restritiva (gov.br); 13 que proíbem ou condicionam; 14 sem termos de conteúdo. **4 sem termo oficial lido (classe E):** BCB e LATAM/LATAM Pass (a página responde 200, mas o termo só renderiza por JavaScript; no BCB só há um aviso numa página do Flickr), Star Alliance e ICO (403/desafio, não contornado). Depois da releitura com User-Agent identificado, Livelo, Magalu (RI) e Santander (RI) passaram de "inacessível" para classe D e o Itaú foi lido e é classe C.

**Leitura prática:** só três domínios têm texto oficial que autoriza expressamente a reutilização — Agência Senado, Câmara dos Deputados e EDPB —, todos institucionais e naturais para **Regulação & Dados** (e para o que o Legislativo trate de consumo, cartões e tecnologia). Para as editorias de mercado (programas, milhas, bancos, varejo, viagem, CRM) não há, hoje, fonte com autorização textual: o proprietário decidiu pela opção (c), **aceitar o risco**, na **DP-28** (seção abaixo): classes A, B e D podem ser habilitadas depois da revisão humana no Studio, citando e linkando a fonte; classe C só caso a caso; classe E segue sem leitura. As opções (a) autorização escrita dos titulares e (b) parecer R0-10 continuam abertas para reduzir o risco. **A primeira matéria real deve sair de Senado ou Câmara** (feeds confirmados; robots da Câmara conferido na rodada simulada de 23/11: feed e matérias permitidos, inclusive para agentes de IA declarados).

| Fonte | Classe | Termos oficiais lidos | O que o texto permite / proíbe (resumo) | Recomendação |
|---|---|---|---|---|
| EDPB (Comitê Europeu de Proteção de Dados) | A | [www.edpb.europa.eu/copyright_en](https://www.edpb.europa.eu/copyright_en) | Reutilização autorizada, com atribuição: "reproduction of textual data and multimedia items which are the property of the EDPB" | candidata a habilitar (decisão do proprietário + revisão humana da fonte) |
| Agência Senado | A | [www12.senado.leg.br/noticias/politica-de-uso](https://www12.senado.leg.br/noticias/politica-de-uso) | "A reprodução de matérias e fotografias é livre, desde que não haja descaracterização de conteúdo" | candidata a habilitar (decisão do proprietário + revisão humana da fonte) |
| Câmara dos Deputados (Portal) | A | [www2.camara.leg.br/termo-de-uso-e-politica-de-pr](https://www2.camara.leg.br/termo-de-uso-e-politica-de-privacidade) | Trechos podem ser reproduzidos "desde que estejam entre aspas" (item 7); informações do portal são "de domínio público" e podem ser reproduzidas (item | candidata a habilitar (decisão do proprietário + revisão humana da fonte) |
| Portal gov.br (CVM, ANPD, Senacon/MJSP, ANAC, MCTI, ANATEL, Min. do Turismo) | B | [www.gov.br/pt-br/termos-de-uso](https://www.gov.br/pt-br/termos-de-uso)<br>[www.gov.br/cvm/pt-br/assuntos/noticias](https://www.gov.br/cvm/pt-br/assuntos/noticias)<br>[www.gov.br/anpd/pt-br](https://www.gov.br/anpd/pt-br) | Não informado no Termo de Uso | NÃO habilitar até parecer (R0-10) |
| Azul — Relações com Investidores | C | [ri.voeazul.com.br/termos-condicoes-de-uso/](https://ri.voeazul.com.br/termos-condicoes-de-uso/) | Reprodução vedada sem autorização prévia da Azul | NÃO habilitar |
| GOL — Relações com Investidores | C | [ri.voegol.com.br/termos-e-condicoes/](https://ri.voegol.com.br/termos-e-condicoes/) | Reprodução vedada sem autorização prévia da GOL | NÃO habilitar |
| ABECS | C | [www.abecs.org.br/termos-de-uso](https://www.abecs.org.br/termos-de-uso) | Item 2.2: "não reproduzir, transferir, distribuir, armazenar e/ou de qualquer maneira utilizar o conteúdo do Aplicativo e do Site" | NÃO habilitar |
| IATA | C | [www.iata.org/en/terms/](https://www.iata.org/en/terms/) | Reprodução "only for your personal, non-commercial use"; reprodução ilimitada/em massa proibida | NÃO habilitar |
| Nubank (newsroom/RI) | C | [nubank.com.br/transparencia/termos-de-uso](https://nubank.com.br/transparencia/termos-de-uso) | "É vedado copiar, reproduzir, distribuir ou reutilizar conteúdos do Nubank sem autorização prévia e expressa" | NÃO habilitar |
| Accor (newsroom) | C | [group.accor.com/en/legal-terms](https://group.accor.com/en/legal-terms) | Nenhum material pode ser copiado, reproduzido ou republicado sem autorização escrita da Accor, salvo uso pessoal, privado e não comercial | NÃO habilitar |
| Marriott (newsroom) | C | [www.marriott.com/about/terms-of-use-modal.mi](https://www.marriott.com/about/terms-of-use-modal.mi) | "downloading, reproduction, or retransmission of the Services (or any part of its content) is strictly prohibited" | NÃO habilitar |
| Salesforce (newsroom) | C | [www.salesforce.com/company/legal/sfdc-website-te](https://www.salesforce.com/company/legal/sfdc-website-terms-of-service/)<br>[www.salesforce.com/company/legal/tmcusageguideli](https://www.salesforce.com/company/legal/tmcusageguidelines/) | "You may not use content from our Sites unless you obtain permission from us or its owner"; "Most uses require specific written permission" | NÃO habilitar |
| HubSpot (newsroom) | C | [legal.hubspot.com/website-terms-of-use](https://legal.hubspot.com/website-terms-of-use)<br>[legal.hubspot.com/content-usage-guidelines](https://legal.hubspot.com/content-usage-guidelines) | Website Terms: conteúdo "may not be copied, reproduced, modified, published"; Diretrizes de Conteúdo: "Feel free to reference or quote up to 75 words  | NÃO habilitar |
| Zendesk (newsroom) | C | [www.zendesk.com.br/company/agreements-and-terms/](https://www.zendesk.com.br/company/agreements-and-terms/terms-of-use/) | Exibir/copiar/baixar "exclusivamente para seu uso pessoal e não comercial" | NÃO habilitar |
| ABAV | C | — (nenhum documento de termos lido) | Rodapé: "Proibida reprodução ou utilização a qualquer título, sob as penas da lei" | NÃO habilitar |
| oneworld | C | [www.oneworld.com/privacy-policy](https://www.oneworld.com/privacy-policy) | "No such materials may be reproduced without the prior written consent"; "No information provided via this website may be republished in any fashion i | NÃO habilitar |
| Itaú (Sites e Aplicativos) | C | [www.itau.com.br/termos-de-uso](https://www.itau.com.br/termos-de-uso) | Item 8: softwares, identidade visual e conteúdo "somente podem ser usados com sua prévia e expressa autorização" | NÃO habilitar |
| Banco do Brasil (RI e site) | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| FEBRABAN | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| Bradesco (RI e hotsite Fidelidade/Livelo) | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| Dotz | D | — (nenhum documento de termos lido) | Só nos Termos da Conta Dotz (aplicativo): cópia, reprodução e uso comercial do conteúdo do Aplicativo "rigorosamente proibidas" | NÃO habilitar |
| ABEMF | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| IDV — Instituto para Desenvolvimento do Varejo | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| ABRAS | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| Brasscom | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| ABRAREC | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| Procon-SP | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| Airlines for America (A4A) | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| Livelo (site e /imprensa) | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| Magazine Luiza (RI) | D | [ri.magazineluiza.com.br/show.aspx](https://ri.magazineluiza.com.br/show.aspx?idMateria=r8+jnEVu1+FnJybGBWO3Uw==) | Não informado (o texto só afirma titularidade: o conteúdo pertence "a nós ou a terceiros que licitamente cederam seu direito de uso") | NÃO habilitar |
| Santander Brasil (RI) | D | — (nenhum documento de termos lido) | Não informado | NÃO habilitar |
| Banco Central do Brasil | E | [www.flickr.com/photos/bancocentralbr/sets/72](https://www.flickr.com/photos/bancocentralbr/sets/72157655361202251) | NÃO LIDO no site oficial | NÃO habilitar até leitura manual dos termos |
| LATAM (RI) e LATAM Pass | E | [www.latamairlines.com/us/en/legal/terms-of-use](https://www.latamairlines.com/us/en/legal/terms-of-use) | NÃO LIDO (200 na releitura, mas o termo só renderiza por JavaScript) | NÃO habilitar até leitura manual dos termos |
| Star Alliance (`star-alliance`) | E | — | robots.txt e site seguem 403 com User-Agent identificado (reconfirmado em 23/11; não contornado) | NÃO habilitar até leitura manual dos termos |
| ICO (Reino Unido) (`ico-uk`) | E | — | desafio Cloudflare ("Just a moment...") com User-Agent identificado (reconfirmado em 23/11; não contornado) | NÃO habilitar até leitura manual dos termos |

## Fonte por fonte

### EDPB (Comitê Europeu de Proteção de Dados)
- **Classe A — reuso autorizado no texto** · fontes cadastradas: edpb · **candidata a habilitar (decisão do proprietário + revisão humana da fonte)**
- **Por quê:** "The reuse of any information of this website is authorized for commercial and non-commercial purposes." O feed anunciado deu 503 na pesquisa anterior: coleta por página, sem feed confirmado.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Reutilização autorizada, com atribuição: "reproduction of textual data and multimedia items which are the property of the EDPB" |
| Resumir/derivar | Não distorcer: "The original meaning or the message of the documents should not be distorted" |
| Linkar | Não informado |
| Imagens/imprensa | Multimídia (imagens, vídeo, fotografias) coberta pela mesma autorização |
| Automação, raspagem, IA | Só exige não contornar medidas técnicas; nada sobre raspagem/IA |
| Atribuição | "The re-user is obliged to acknowledge the source"; não apagar autoria/fonte |

**Documentos:**
- [direitos_autorais] https://www.edpb.europa.eu/copyright_en — leitor: lido; bruto: texto bruto lido (4013 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao_texto_: “reproduction of textual data and multimedia items which are the property of the EDPB”
- ✓ _resumo_obra_derivada_: “The original meaning or the message of the documents should not be distorted.”
- ✓ _imagens_material_imprensa_: “multimedia items such as texts, drawings, graphics, logos, icons, images, audio and video material, photographs.”
- ✓ _automacao_raspagem_ia (somente contornar medidas tecnicas; nada sobre scraping/IA)_: “not to seek to circumvent the technical measures put in place to protect documents and multimedia items.”
- ✓ _atribuicao_: “The re-user is obliged to acknowledge the source of the document;”
- ✓ _atribuicao_: “The user undertakes not to delete or change the indications of the author or the source.”
- ✓ _uso_comercial_: “The reuse of any information of this website is authorized for commercial and non-commercial purposes.”
- ✓ _responsabilidade_: “The European Data Protection Board cannot be held liable for any consequence stemming from the reuse.”

**robots.txt:** lido

### Agência Senado
- **Classe A — reuso autorizado no texto** · fontes cadastradas: senado-noticias · **candidata a habilitar (decisão do proprietário + revisão humana da fonte)**
- **Por quê:** Feed RSS confirmado na pesquisa anterior. Atenção: a página trata do conteúdo da Agência Senado; fotos ou textos de terceiros republicados ali não estão cobertos pelo que foi lido.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | "A reprodução de matérias e fotografias é livre, desde que não haja descaracterização de conteúdo" |
| Resumir/derivar | Só o limite: não descaracterizar o conteúdo |
| Linkar | Não informado |
| Imagens/imprensa | Fotografias: reprodução livre nas mesmas condições |
| Automação, raspagem, IA | Não informado |
| Atribuição | "mediante a citação da Agência Senado e do autor"; áudio: créditos à Rádio Senado |

**Documentos:**
- [politica_de_conteudo] https://www12.senado.leg.br/noticias/politica-de-uso — leitor: lido; bruto: texto bruto lido (3135 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao_texto_: “A reprodução de matérias e fotografias é livre, desde que não haja descaracterização de conteúdo”
- ✓ _imagens_material_imprensa_: “A reprodução de matérias e fotografias é livre, desde que não haja descaracterização de conteúdo”
- ✓ _atribuicao_: “mediante a citação da Agência Senado e do autor”
- ✓ _atribuicao (audio)_: “No caso dos arquivos de áudio, deverão constar dos créditos à Rádio Senado”

**robots.txt:** lido

### Câmara dos Deputados (Portal)
- **Classe A — reuso autorizado no texto** · fontes cadastradas: camara-noticias · **candidata a habilitar (decisão do proprietário + revisão humana da fonte)**
- **Por quê:** Feed RSS confirmado. O robots.txt de www.camara.leg.br lista agentes de IA (GPTBot, ClaudeBot etc.) com Disallow só de caminhos específicos: o coletor já respeita robots.txt, mas confira os caminhos antes de habilitar.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Trechos podem ser reproduzidos "desde que estejam entre aspas" (item 7); informações do portal são "de domínio público" e podem ser reproduzidas (item 29) |
| Resumir/derivar | Não informado |
| Linkar | Não informado (só links externos exibidos pelo portal) |
| Imagens/imprensa | "Você pode reproduzir gratuitamente dados, imagens e infografias" |
| Automação, raspagem, IA | Só coíbe robôs que imitam pessoas na participação; robots.txt lista agentes de IA com Disallow de caminhos específicos |
| Atribuição | Citar a fonte "Câmara dos Deputados" e a autoria, quando houver |

**Documentos:**
- [termos_de_uso] https://www2.camara.leg.br/termo-de-uso-e-politica-de-privacidade — leitor: lido; bruto: texto bruto lido (10882 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao_texto / citacao (item 7)_: “reproduzir trechos de textos, notícias ou estudos publicados no Portal da Câmara, desde que estejam entre aspas”
- ✓ _citacao (item 29)_: “Trechos de textos, notícias ou estudos publicados devem ser citados entre aspas”
- ✓ _imagens_material_imprensa (item 7)_: “Você pode reproduzir gratuitamente dados, imagens e infografias publicados no portal da Câmara”
- ✓ _atribuicao (item 7)_: “desde que citada a fonte "Câmara dos Deputados" e a autoria da informação, quando houver.”
- ✓ _licenca / reproducao (item 29)_: “Todas as informações publicadas no Portal da Câmara são de domínio público, gratuitas e podem ser reproduzidas”
- ✓ _automacao_raspagem_ia (item 22, robos em participacao/interacao)_: “Podemos coibir a participação de sistemas automatizados ou robôs (scripts, bots, entre outros) que tentem imitar pessoas.”
- ✓ _automacao_raspagem_ia (item 37, uso de IA pela propria Camara; nao trata de terceiros)_: “A Câmara dos Deputados pode usar ferramentas de Inteligência Artificial (IA) para gerar conteúdos”
- ✓ _link (item 40, apenas links do portal para externos)_: “O portal pode exibir links para conteúdos externos, sem, contudo, ser responsável pelo conteúdo exibido no site lincado.”

**robots.txt:** lido — User-agents de IA listados (GPTBot, ChatGPT-User, Google-Extended, anthropic-ai, Claude-Web, Omgilibot, Omgili, FacebookBot, CCBot, PerplexityBot), cada um com as mesmas regras Disallow por caminho (nao bloqueio total do site). Segundo a ferramenta, ha comenta

### Portal gov.br (CVM, ANPD, Senacon/MJSP, ANAC, MCTI, ANATEL, Min. do Turismo)
- **Classe B — licença com restrição** · fontes cadastradas: cvm, anpd, senacon, anac, mcti, anatel, mtur · **NÃO habilitar até parecer (R0-10)**
- **Por quê:** O único texto de licença é o rodapé "Creative Commons Atribuição-SemDerivações 3.0 Não Adaptada", conferido em CVM e ANPD; ANAC, MCTI, ANATEL, Senacon e Turismo NÃO foram abertos (licença não confirmada nesses órgãos). Se reescrever fatos com citação é ou não "derivação" é questão jurídica que este dossiê não decide.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado no Termo de Uso |
| Resumir/derivar | Rodapé: licença "SemDerivações"; alcance sobre reescrita de fatos = ponto jurídico |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado (robots sem sinal de IA) |
| Atribuição | Não informado no Termo; atribuição é condição da licença CC BY |

**Documentos:**
- [termos_de_uso] https://www.gov.br/pt-br/termos-de-uso — leitor: lido; bruto: texto bruto lido (39663 caracteres)
- [licenca] https://www.gov.br/cvm/pt-br/assuntos/noticias — leitor: parcial; bruto: texto bruto lido (19569 caracteres)
- [licenca] https://www.gov.br/anpd/pt-br — leitor: parcial; bruto: texto bruto lido (4246 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _licenca_: “Todo o conteúdo deste site está publicado sob a licença Creative Commons Atribuição-SemDerivações 3.0 Não Adaptada”
- ✓ _licenca_: “Todo o conteúdo deste site está publicado sob a licença Creative Commons Atribuição-SemDerivações 3.0 Não Adaptada.”
- ✓ _licenca_: “Todo o conteúdo deste site está publicado sob a licença Creative Commons Atribuição-SemDerivações 3.0 Não Adaptada”

**robots.txt:** lido

### Azul — Relações com Investidores
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: azul-ri · **NÃO habilitar**
- **Por quê:** Texto expresso: "sendo vedada sua reprodução, sem prévia autorização da Azul". Caminho possível: pedir autorização por escrito à Azul.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Reprodução vedada sem autorização prévia da Azul |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [termos_de_uso] https://ri.voeazul.com.br/termos-condicoes-de-uso/ — leitor: lido; bruto: texto bruto lido (8611 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao de texto / direitos autorais_: “Salvo disposição em contrário, todo o conteúdo das páginas desse website, tais como informações, materiais, instrumentos,”
- ✓ _reproducao de texto_: “sendo vedada sua reprodução, sem prévia autorização da Azul.”
- ✓ _link (sites de terceiros; nao trata de links para o site)_: “A Azul não se responsabiliza pelo conteúdo de outros websites (a) cujos endereços estejam disponíveis nas páginas deste”
- ✓ _escopo de uso_: “A navegação e consulta pública desse website se sujeita aos Termos e Condições abaixo:”

**robots.txt:** lido

### GOL — Relações com Investidores
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: gol-ri · **NÃO habilitar**
- **Por quê:** Mesmo texto da Azul: "sendo vedada sua reprodução, sem prévia autorização da GOL". Caminho possível: autorização escrita.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Reprodução vedada sem autorização prévia da GOL |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [termos_de_uso] https://ri.voegol.com.br/termos-e-condicoes/ — leitor: lido; bruto: texto bruto lido (7760 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao de texto / direitos autorais_: “Salvo disposição em contrário, todo o conteúdo das páginas desse website, tais como informações, materiais”
- ✓ _reproducao de texto_: “sendo vedada sua reprodução, sem prévia autorização da GOL.”
- ✓ _link (sites de terceiros; nao trata de links para o site)_: “A GOL não se responsabiliza pelo conteúdo de outros websites (a) cujos endereços estejam disponíveis”

**robots.txt:** lido

### ABECS
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: abecs · **NÃO habilitar**
- **Por quê:** Os termos tratam do aplicativo e do site juntos; os itens de uso comercial e atribuição (3.2/3.3) valem para materiais ENVIADOS por usuários, não para o uso do conteúdo da ABECS por terceiros.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Item 2.2: "não reproduzir, transferir, distribuir, armazenar e/ou de qualquer maneira utilizar o conteúdo do Aplicativo e do Site" |
| Resumir/derivar | Não informado para terceiros |
| Linkar | Não informado |
| Imagens/imprensa | Item 2.1: imagens, fotografias e marcas são propriedade da ABECS |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado para uso por terceiros |

**Documentos:**
- [termos_de_uso] https://www.abecs.org.br/termos-de-uso — leitor: lido; bruto: texto bruto lido (16012 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao de texto (item 2.2)_: “não reproduzir, transferir, distribuir, armazenar e/ou de qualquer maneira utilizar o conteúdo do Aplicativo e do Site”
- ✓ _imagens / propriedade (item 2.1)_: “marcas, logotipos, nomes comerciais, layouts, gráficos e design de interface, imagens, ilustrações, fotografias”
- ✓ _licenca / direitos (item 2.3)_: “nenhuma informação contida no Aplicativo e no Site deve ser interpretada como cessão, licença ou transferência de direitos”
- ✓ _licenca de uso do aplicativo (item 1.2)_: “O Aplicativo consiste em uma licença de uso concedida pela ABECS a seus usuários em dispositivos móveis”
- ✓ _link (item 4.6; trata de links para outros sites)_: “O Aplicativo e o Site poderão fornecer conexões ou referências a outros sites, originados de outras companhias”
- ✓ _obra derivada (item 3.3; refere-se a Materiais enviados por usuario a ABECS)_: “inclusive criação de obras derivadas”
- ✓ _atribuicao (item 3.3; refere-se a Materiais enviados por usuario)_: “seu nome será citado sempre que os Materiais forem utilizados pela ABECS, conforme informado pelo Usuário”
- ✓ _uso comercial (item 3.2; refere-se a Materiais enviados por usuario)_: “A ABECS e suas empresas afiliadas e parceiras poderão usar e tornar públicos os Materiais, para qualquer propósito”

**robots.txt:** lido

### IATA
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: iata · **NÃO habilitar**
- **Por quê:** Uso limitado a pessoal e não comercial ("not intended for commercial exploitation unless expressly agreed in writing by IATA").

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Reprodução "only for your personal, non-commercial use"; reprodução ilimitada/em massa proibida |
| Resumir/derivar | Proíbe "create derivative works" e modificar dados |
| Linkar | Links de terceiros apenas (não trata de links para o site) |
| Imagens/imprensa | Texto, dados e gráficos protegidos (seção 5) |
| Automação, raspagem, IA | Cláusula sobre ferramentas de IA generativa; sem menção a raspagem/robôs |
| Atribuição | Exige manter avisos e citar IATA como fonte |

**Documentos:**
- [termos_de_uso] https://www.iata.org/en/terms/ — leitor: lido; bruto: texto bruto lido (20433 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao de texto (secao 3)_: “IATA authorizes you to download or reproduce selected materials from this Website only for your personal, non-commercial use”
- ✓ _reproducao em massa (secao 3)_: “Without limitation, unlimited or wholesale reproduction, copying of the content”
- ✓ _obra derivada (secao 3)_: “You may not otherwise modify, disassemble, create derivative works, distribute, reproduce, publicly display”
- ✓ _modificacao de dados (secao 3)_: “unwarranted modification of data and information within the content is not permitted”
- ✓ _link (secao 4; links de terceiros)_: “IATA is providing these Third Party Links to you only as a convenience”
- ✓ _propriedade de conteudo/imagens (secao 5)_: “text, data, graphics, and icons, are copyrighted materials owned by IATA”
- ✓ _IA (secao 3, 'Your Conduct'; fragmento da ferramenta)_: “any generative artificial intelligence chatbot, platform or tool”
- ✓ _IA (secao 3; fragmento da ferramenta)_: “use the AI Tool for any interrogation, assessment or analysis”
- ✓ _atribuicao (secao 3)_: “provided that you retain all copyright and other proprietary notices contained in the original materials”
- ✓ _atribuicao (secao 3)_: “that the title or database brand name and IATA name is stated as the source”
- ✓ _uso comercial (secao 3)_: “it is not intended for commercial exploitation unless expressly agreed in writing by IATA”
- ✓ _licenca (secao 1)_: “you are granted a single user, non-exclusive, non-transferrable, revocable limited license to access and use this Website”

**robots.txt:** lido

### Nubank (newsroom/RI)
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: nubank-newsroom · **NÃO habilitar**
- **Por quê:** Os termos lidos estão em nubank.com.br; os rodapés de nu.com (newsroom, press kit, investidores) NÃO têm link de termos, então não está confirmado que valem para nu.com. Se valerem, proíbem a coleta automatizada e até o link sem autorização.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | "É vedado copiar, reproduzir, distribuir ou reutilizar conteúdos do Nubank sem autorização prévia e expressa" |
| Resumir/derivar | Não informado para conteúdo do site |
| Linkar | Hiperlink para páginas do Nubank "depende de autorização prévia e específica" |
| Imagens/imprensa | Não usar marca, nome, logotipo; o press kit oferece download de logo e imagens |
| Automação, raspagem, IA | Coleta automatizada (scraping, data mining) sem autorização é vedada |
| Atribuição | Não informado |

**Documentos:**
- [termos_de_uso] https://nubank.com.br/transparencia/termos-de-uso — leitor: lido; bruto: texto bruto lido (25908 caracteres)
- [outro] https://nu.com/en/newsroom — leitor: lido; bruto: texto bruto lido (2510 caracteres)
- [outro] https://nu.com/en/newsroom/press-kit — leitor: lido; bruto: texto bruto lido (1468 caracteres)
- [outro] https://nu.com/en/investors — leitor: lido; bruto: texto bruto lido (1669 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reprodução de texto_: “É vedado copiar, reproduzir, distribuir ou reutilizar conteúdos do Nubank sem autorização prévia e expressa do Nubank ou de terceiros titulares, conforme a legislação de direitos autorais, software e propriedade industrial.”
- ✓ _link para o site_: “Qualquer hiperlink do seu site ou aplicativo para páginas, produtos ou serviços do Nubank depende de autorização prévia e específica do Nubank.”
- ✓ _automação/raspagem/mineração de dados_: “Coleta automatizada e acesso indevido: acessar e coletar dados por meios automatizados (scraping, data mining, extração) sem autorização, nem tentar acessar dados sem permissão.”
- ✓ _imagens/marcas (uso de marca, nome, logotipo)_: “Sem uso indevido de marca: fora do próprio link, não usar marca, nome, logotipo, slogan, look and feel ou outros sinais do Nubank, salvo se houver autorização prévia e específica e observância às diretrizes de marca.”
- ✓ _uso comercial (fragmento; contexto exato da cláusula não confirmado)_: “comercializar, revender, alugar ou compartilhar acesso aos serviços, produtos e aplicativo do Nubank.”
- ✓ _licença (fragmento; refere-se a licença concedida ao usuário, objeto exato não confirmado)_: “Você recebe uma licença limitada, não exclusiva, intransferível, gratuita e revogável”
- ✓ _imagens/material de imprensa_: “Download our logo, app images, and photos.”
- ✓ _aviso de copyright (nu.com)_: “© 2026 Nu Holdings Ltd.”

**robots.txt:** lido

### Accor (newsroom)
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: accor-newsroom · **NÃO habilitar**
- **Por quê:** Uso comercial do conteúdo "expressly prohibited". Robôs e IA não são citados expressamente.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Nenhum material pode ser copiado, reproduzido ou republicado sem autorização escrita da Accor, salvo uso pessoal, privado e não comercial |
| Resumir/derivar | Proíbe modificar; resumos não mencionados |
| Linkar | Link para o site "is subject to the prior agreement of Accor SA" |
| Imagens/imprensa | Fotografias: sem licença; aviso de que não vinculam contratualmente |
| Automação, raspagem, IA | "The extraction and/or repeated re-use of the content, even non substantial, of this site is also prohibited" |
| Atribuição | Cópias autorizadas devem trazer "©Copyright Accor SA" |

**Documentos:**
- [termos_de_uso] https://group.accor.com/en/legal-terms — leitor: lido; bruto: texto bruto lido (13889 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reprodução de texto_: “No material from the www.group.accor.com site may be copied, reproduced, modified, republished, uploaded, distorted, transmitted or distributed in any way whatsoever, on any medium whatsoever, in part or in full,”
- ✓ _reprodução de texto (exceção)_: “without the prior written authorization of Accor SA except strictly for personal, private and non-commercial use, without modifying the material on the www.group.accor.com site.”
- ✓ _link para o site_: “The creation of links to the www.group.accor.com site is subject to the prior agreement of Accor SA.”
- ✓ _extração/reutilização (não menciona robôs/IA expressamente)_: “The extraction and/or repeated re-use of the content, even non substantial, of this site is also prohibited.”
- ✓ _uso comercial_: “In particular, use of the content of this site for commercial purposes is expressly prohibited.”
- ✓ _atribuição/crédito (em cópias autorizadas)_: “The following notice must in particular appear on all authorized copies of all or part of the site content: ©Copyright Accor SA.”
- ✓ _licença (de acesso)_: “Any current or prospective customer or partner has a personal, non-exclusive, non-assignable, non-transferable right to access the information contained on the www.group.accor.com site for his own hotel reservation needs.”

**robots.txt:** lido

### Marriott (newsroom)
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: marriott-news · **NÃO habilitar**
- **Por quê:** Os termos falam em "Services"; não está confirmado que valem para news.marriott.com (a página só renderizou o título). Trechos são fragmentos de extração, conferidos no HTML bruto.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | "downloading, reproduction, or retransmission of the Services (or any part of its content) is strictly prohibited" |
| Resumir/derivar | Não informado |
| Linkar | Links de mecanismos de busca permitidos |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Proíbe "robots, spiders, or other automatic or high-volume methods"; cláusula de IA sobre os "AI Services" |
| Atribuição | Não informado |

**Documentos:**
- [termos_de_uso] https://www.marriott.com/about/terms-of-use-modal.mi — leitor: lido; bruto: texto bruto lido (36095 caracteres)
- [termos_de_uso] https://www.marriott.com/about/terms-of-use.mi — leitor: inacessivel; bruto: inacessivel (HTTP 403)
- [outro] https://news.marriott.com/ — leitor: parcial; bruto: nao_verificavel (página sem texto no HTML: 20 caracteres; provável JavaScript)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reprodução de texto (fragmento)_: “downloading, reproduction, or retransmission of the Services (or any part of its content) is strictly prohibited.”
- ✓ _link para o site (fragmento)_: “(standard search engine technology that links users to our Services is permitted)”
- ✓ _automação/robôs (fragmento)_: “use robots, spiders, or other automatic or high-volume methods or devices”
- ✓ _IA (fragmento; refere-se a 'AI Services, Responses')_: “use the AI Services, Responses, related data, or models to create, train, modify, adapt, improve, or otherwise develop”
- ✓ _uso comercial (fragmento)_: “You may use content on the Services and Responses for your personal, non-commercial use”
- ✓ _licença (fragmento)_: “No license to, or right in, any such trademarks, patents, copyrighted materials,”
- ✓ _aviso de copyright_: “© 1996 - 2026 Marriott International, Inc. All rights reserved. Marriott proprietary information.”

**robots.txt:** lido

### Salesforce (newsroom)
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: salesforce-newsroom · **NÃO habilitar**
- **Por quê:** Feed RSS existe, mas os termos exigem permissão para usar o conteúdo.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | "You may not use content from our Sites unless you obtain permission from us or its owner"; "Most uses require specific written permission" |
| Resumir/derivar | Não informado |
| Linkar | "You may link to Salesforce’s content as long as you do not commercialize the links" |
| Imagens/imprensa | Proibido exibir imagens/mídia; capturas de tela só para tutoriais educacionais |
| Automação, raspagem, IA | Não informado (ToS sobre conteúdo do site) |
| Atribuição | Declaração de atribuição obrigatória em qualquer uso |

**Documentos:**
- [termos_de_uso] https://www.salesforce.com/company/legal/sfdc-website-terms-of-service/ — leitor: lido; bruto: texto bruto lido (35803 caracteres)
- [politica_de_conteudo] https://www.salesforce.com/company/legal/tmcusageguidelines/ — leitor: lido; bruto: texto bruto lido (37581 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao_texto / uso de conteudo (ToS, secao G)_: “You may not use content from our Sites unless you obtain permission from us or its owner.”
- ✓ _licenca / propriedade (ToS, secao G)_: “Using our Site does not give you ownership of any intellectual property rights to the content you access.”
- ✓ _reproducao_texto / imagens (Guidelines)_: “You may not use or display any of Salesforce’s content, including images, text, audio, video, or media”
- ✓ _link (Guidelines)_: “You may link to Salesforce’s content as long as you do not commercialize the links.”
- ✓ _reproducao_texto (Guidelines)_: “Most uses require specific written permission”
- ✓ _imagens_material_imprensa (Guidelines, screenshots)_: “Screenshots of Salesforce’s software are permitted solely for educational tutorials”
- ✓ _atribuicao (Guidelines)_: “The following attribution statement must accompany any use of Salesforce’s copyrighted works:”

**robots.txt:** lido

### HubSpot (newsroom)
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: hubspot-newsroom · **NÃO habilitar**
- **Por quê:** Conflito entre documentos: as diretrizes permitem citar até 75 palavras com atribuição, mas os termos do site vedam sistemas automatizados, e as diretrizes dizem "You cannot make money off of our content" (o portal é comercial). A resolução é decisão jurídica.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Website Terms: conteúdo "may not be copied, reproduced, modified, published"; Diretrizes de Conteúdo: "Feel free to reference or quote up to 75 words of any of our text content" |
| Resumir/derivar | Website Terms vedam "create derivative works" |
| Linkar | Compartilhar links permitido (diretrizes) |
| Imagens/imprensa | Diretrizes: imagens originais da HubSpot podem ser republicadas na íntegra |
| Automação, raspagem, IA | Website Terms proíbem "robots," "spiders" e sistemas automatizados |
| Atribuição | "Attribute HubSpot as the source" |

**Documentos:**
- [termos_de_uso] https://legal.hubspot.com/website-terms-of-use — leitor: lido; bruto: texto bruto lido (29643 caracteres)
- [politica_de_conteudo] https://legal.hubspot.com/content-usage-guidelines — leitor: lido; bruto: texto bruto lido (12496 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao_texto (Website Terms, sec. 3)_: “the Content may not be copied, reproduced, modified, published”
- ✓ _resumo_obra_derivada (Website Terms, sec. 3)_: “create derivative works based on the Content or a Site, in whole or in part, by any means”
- ✓ _link / framing (Website Terms, sec. 2(vii))_: “mirror or frame a Site or any part of it on any other web site or web page.”
- ✓ _automacao_raspagem_ia (Website Terms, sec. 2(v))_: “use or launch any automated system, including without limitation, "robots," "spiders,"”
- ✓ _uso_comercial (Website Terms, sec. 1)_: “solely for your non-commercial, personal purposes and/or to learn about HubSpot”
- ✓ _licenca (Website Terms, sec. 3)_: “You do not receive any right or license to use the foregoing.”
- ✓ _reproducao_texto (Content Usage Guidelines)_: “we can't let you republish in full any of our text-based content”
- ✓ _citacao (Content Usage Guidelines)_: “Feel free to reference or quote up to 75 words of any of our text content”
- ✓ _link (Content Usage Guidelines)_: “Feel free to share links to any of our content by email and social media.”
- ✓ _imagens_material_imprensa (Content Usage Guidelines)_: “Feel free to republish in full any HubSpot-original images (such as charts, graphs, cartoons, infographics)”
- ✓ _atribuicao (Content Usage Guidelines)_: “Attribute HubSpot as the source.”
- ✓ _uso_comercial (Content Usage Guidelines)_: “You cannot make money off of our content.”

**robots.txt:** lido

### Zendesk (newsroom)
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: zendesk-newsroom · **NÃO habilitar**
- **Por quê:** Sem feed confirmado (404 na pesquisa anterior).

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Exibir/copiar/baixar "exclusivamente para seu uso pessoal e não comercial" |
| Resumir/derivar | Proíbe "traduzir, criar trabalhos derivados, republicar" |
| Linkar | "espelhar, enquadrar" proibidos; links não tratados |
| Imagens/imprensa | Sem regra específica nos termos do site (Media Kit em PDF só parcialmente lido) |
| Automação, raspagem, IA | Seção 4.5 trata de inflar visualizações; nada sobre raspagem/IA |
| Atribuição | Não remover avisos de direitos autorais |

**Documentos:**
- [termos_de_uso] https://www.zendesk.com.br/company/agreements-and-terms/terms-of-use/ — leitor: lido; bruto: texto bruto lido (27682 caracteres)
- [outro] https://web-assets.zendesk.com/zendesk/pdf/Zendesk_Media_Kit_2026_V1.1.pdf — leitor: parcial; bruto: nao_verificavel (PDF)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao_texto (secao 6)_: “você não pode copiar, distribuir, reproduzir, espelhar, enquadrar, exibir publicamente”
- ✓ _reproducao_texto / excecao (secao 6)_: “Exceto com a nossa permissão prévia e expressa por escrito ou conforme permitido por lei”
- ✓ _resumo_obra_derivada (secao 6)_: “traduzir, criar trabalhos derivados, republicar ou transmitir os Sites”
- ✓ _uso_comercial / uso pessoal (secao 6)_: “Você pode exibir, copiar e baixar Conteúdo dos Sites exclusivamente para seu uso pessoal e não comercial”
- ✓ _uso_comercial (secao 5(b))_: “reproduzir, duplicar, copiar, vender, revender ou explorar para qualquer finalidade comercial”
- ✓ _automacao (secao 4.5; trata de inflar visualizacoes)_: “usar nenhum serviço, tecnologia ou sistema automatizado para aumentar artificialmente as visualizações”
- ✓ _atribuicao / avisos de direitos autorais (secao 6)_: “você não remova nenhum aviso de direitos autorais ou de propriedade do Conteúdo”
- ✓ _licenca (conteudo enviado por usuarios, secao 4.10)_: “nos concede o direito e a licença universais, permanentes, irrevogáveis, não exclusivos e isentos de royalties”

**robots.txt:** lido

### ABAV
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: abav · **NÃO habilitar**
- **Por quê:** Não há documento de termos: a proibição está num aviso de rodapé.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Rodapé: "Proibida reprodução ou utilização a qualquer título, sob as penas da lei" |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Página Imprensa sem termos de imagens |
| Automação, raspagem, IA | robots.txt: Content-Signal "ai-train=no" e mais de 30 agentes de IA com Disallow: / (segundo a leitura da pesquisa; o robots não foi conferido por mim) |
| Atribuição | Não informado |

**Documentos:**
- [privacidade_apenas] https://abav.com.br/politica-de-privacidade/ — leitor: lido; bruto: texto bruto lido (19015 caracteres)
- [outro] https://abav.com.br/imprensa/ — leitor: lido; bruto: texto bruto lido (8395 caracteres)
- [outro] https://abav.com.br/ — leitor: lido; bruto: texto bruto lido (11252 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao_texto / uso (aviso no rodape, nao documento de termos)_: “Todo o conteúdo deste site é de uso exclusivo da ABAV.”
- ✓ _reproducao_texto / uso (aviso no rodape, nao documento de termos)_: “Proibida reprodução ou utilização a qualquer título, sob as penas da lei.”

**robots.txt:** lido — Segundo a ferramenta: "Content-Signal: search=yes,ai-train=no,use=reference" para User-agent: *; mais de 30 User-agents de IA/crawlers com Disallow: / (ex.: GPTBot, ClaudeBot, anthropic-ai, Claude-Web, CCBot, Google-Extended, Applebot-Extended, Bytespider, Ama

### oneworld
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: oneworld · **NÃO habilitar**
- **Por quê:** Os termos estão dentro da página de política de privacidade. Um fragmento chegou truncado ("is prohibit").

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | "No such materials may be reproduced without the prior written consent"; "No information provided via this website may be republished in any fashion in any public forum" |
| Resumir/derivar | Não informado |
| Linkar | Só links de saída |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | "Automated access to this website, for example, via a screen scraper, bot, etc. is prohibit[ed]" (fragmento) |
| Atribuição | Não informado |

**Documentos:**
- [termos_de_uso] https://www.oneworld.com/privacy-policy — leitor: lido; bruto: texto bruto lido (18184 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao_texto_: “No such materials may be reproduced without the prior written consent of the applicable owners”
- ✓ _citacao / republicacao_: “No information provided via this website may be republished in any fashion in any public forum.”
- ✓ _direitos_autorais (titularidade)_: “Trademarks, brands and copyright material contained on this website belong to”
- ✓ _automacao_raspagem_ia_: “Automated access to this website, for example, via a "screen scraper," "bot," etc. is prohibit”
- ✓ _link (apenas links de saida)_: “This website contains links to other sites.”
- ✓ _licenca (somente conteudo enviado por usuarios)_: “a worldwide, perpetual, royalty-free, non-exclusive, irrevocable, transferable, sublicensable license”

**robots.txt:** lido

### Itaú (Sites e Aplicativos)
- **Classe C — texto proíbe ou condiciona** · fontes cadastradas: itau-ri · **NÃO habilitar**
- **Por quê:** Releitura de 23/11 com User-Agent identificado: 200. Os termos lidos são dos "Sites e Aplicativos do Itaú Unibanco"; o site de RI do Itaú é outro host e não foi aberto. O robots.txt convida LLMs e buscadores e traz Crawl-delay: 10.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Item 8: softwares, identidade visual e conteúdo "somente podem ser usados com sua prévia e expressa autorização" |
| Resumir/derivar | Não informado |
| Linkar | Links para terceiros apenas |
| Imagens/imprensa | Identidade visual e marcas só com autorização |
| Automação, raspagem, IA | Item 6: veda "qualquer sistema/aplicação automatizada para realizar consultas, acessos ou qualquer outra operação massificada... sem autorização" |
| Atribuição | Não informado |

**Documentos:**
- [termos_de_uso] https://www.itau.com.br/termos-de-uso — leitor: lido; bruto: texto bruto lido (15397 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _automação/raspagem_: “Usar qualquer sistema/aplicação automatizada para realizar consultas, acessos ou qualquer outra operação massificada, para qualquer finalidade, sem autorização do Itaú Unibanco”
- ✓ _reprodução/uso de conteúdo (item 8)_: “Os seguintes itens pertencem ao Itaú Unibanco e somente podem ser usados com sua prévia e expressa autorização”
- ✓ _conteúdo e identidade visual (item 8)_: “assim como sua identidade visual e conteúdo”
- ✓ _links (para terceiros)_: “Nossos Sites e Aplicativos podem conter links para sites e aplicativos de terceiros.”

**robots.txt:** lido — comentário "Permitir indexação e leitura por LLMs e buscadores"; lista agentes de IA (Google-Extended, ClaudeBot, PerplexityBot, CCBot) e há "Crawl-delay: 10"

### Banco do Brasil (RI e site)
- **Classe D — sem termos de conteúdo** · fontes cadastradas: bb-ri · **NÃO habilitar**
- **Por quê:** A página "Políticas de Uso e Privacidade" renderizou só a navegação (a URL com #/ deu 404). Só há rodapé "Todos os direitos reservados" (citação não conferida no HTML bruto). Não dá para afirmar o que o BB permite.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [outro] https://www.bb.com.br/pbb/pagina-inicial/voce/politicas-de-uso-e-privacidade — leitor: parcial; bruto: texto bruto lido (28382 caracteres)
- [outro] https://www.bb.com.br/pbb/pagina-inicial/voce/politicas-de-uso-e-privacidade#/ — leitor: nao_encontrado; bruto: texto bruto lido (28382 caracteres)
- [outro] https://ri.bb.com.br/ — leitor: parcial; bruto: texto bruto lido (2543 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✗ _copyright (rodape de ri.bb.com.br; sem detalhamento)_: “© Todos os direitos reservados” (NÃO confere com o texto bruto: não usar como literal)

**robots.txt:** lido

### FEBRABAN
- **Classe D — sem termos de conteúdo** · fontes cadastradas: febraban · **NÃO habilitar**
- **Por quê:** A política de privacidade cita "Termos e Condições de Uso", mas esse documento não foi localizado (/termos-de-uso não existe). Só há rodapé "Todos os direitos reservados". Duas citações da privacidade não conferem no HTML bruto e ficam sinalizadas.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [outro] https://portal.febraban.org.br/ — leitor: lido; bruto: texto bruto lido (10206 caracteres)
- [privacidade_apenas] https://portal.febraban.org.br/privacidade?idioma=pt-br — leitor: lido; bruto: texto bruto lido (21081 caracteres)
- [outro] https://portal.febraban.org.br/termos-de-uso — leitor: nao_encontrado; bruto: texto bruto lido (10206 caracteres)
- [outro] https://febrabantech.febraban.org.br/termos-privacidade — leitor: parcial; bruto: nao_verificavel (página sem texto no HTML: 85 caracteres; provável JavaScript)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _aviso de copyright (único aviso encontrado no portal)_: “© 2026 FEBRABAN Todos os direitos reservados.”
- ✓ _referência a Termos e Condições de Uso (documento em si não localizado)_: “ou prática de atividade contrárias à presente Política, aos Termos e Condições de Uso ou à legislação vigente,”
- ✓ _links (para sites de terceiros, na política de privacidade)_: “poderá conter links para outros sites”

**robots.txt:** lido

### Bradesco (RI e hotsite Fidelidade/Livelo)
- **Classe D — sem termos de conteúdo** · fontes cadastradas: bradesco-ri; fonte do Intelligence: hotsite Fidelidade · **NÃO habilitar**
- **Por quê:** Nenhum termo de uso/direitos autorais geral nos rodapés. O PDF de Condições do Internet Banking é de outro serviço e seu texto não pôde ser extraído (nada registrado). Só há "© 2026 Bradesco RI".

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | robots lista agentes de IA, no mesmo grupo do "*" com Allow: /, sem bloqueio |
| Atribuição | Não informado |

**Documentos:**
- [outro] https://www.bradescori.com.br/ — leitor: lido; bruto: texto bruto lido (3231 caracteres)
- [outro] https://banco.bradesco/cartoes/hotsitefidelidade/ — leitor: lido; bruto: texto bruto lido (21183 caracteres)
- [outro] https://assets.bradesco/content/dam/portal-bradesco/assets/exclusive/pdf/condicoes_de_uso_do_bradesco_internet_banking.pdf — leitor: inacessivel; bruto: nao_verificavel (PDF)

**Trechos literais citados (✓ conferido no HTML bruto):**
- — _aviso de copyright (bradescori.com.br)_: “© 2026 Bradesco RI.” (curto demais para conferir)

**robots.txt:** lido — Linhas User-agent de IA presentes: GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended. Estão no MESMO grupo de User-agent: * e Spacecat/1.0, com Allow: / (ou seja, nenhum bloqueio específico de IA

### Dotz
- **Classe D — sem termos de conteúdo** · fontes cadastradas: dotz (fonte do Intelligence) · **NÃO habilitar**
- **Por quê:** Não há termos de uso do SITE dotz.com.br: o único documento com cláusulas de propriedade intelectual rege o aplicativo/conta. A home só renderizou o título.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Só nos Termos da Conta Dotz (aplicativo): cópia, reprodução e uso comercial do conteúdo do Aplicativo "rigorosamente proibidas" |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Uso não autorizado de marca/logotipo vedado (termos da conta) |
| Automação, raspagem, IA | Não informado para o site |
| Atribuição | Não informado |

**Documentos:**
- [outro] https://www.dotz.com.br/home — leitor: parcial; bruto: nao_verificavel (página sem texto no HTML: 61 caracteres; provável JavaScript)
- [outro] https://privacidade.dotz.com.br/ — leitor: lido; bruto: texto bruto lido (4420 caracteres)
- [outro] https://privacidade.dotz.com.br/index.php/regulamentos-e-termos-de-uso/ — leitor: lido; bruto: texto bruto lido (2229 caracteres)
- [outro] https://privacidade.dotz.com.br/termos-e-condicoes-de-uso-da-conta-dotz/ — leitor: lido; bruto: texto bruto lido (34774 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reprodução / uso comercial (conteúdo do Aplicativo, cl. 10.2 dos Termos da Conta Dotz)_: “A exploração comercial, transmissão, divulgação, modificação, reprodução, cópia ou quaisquer outras formas de utilização comercial de tal conteúdo pelo usuário são rigorosamente proibidas.”
- ✓ _imagens/marcas (cl. 10.3)_: “O uso não autorizado de qualquer marca, logotipo e/ou design da CGSSP é vedado”
- ✓ _propriedade intelectual (cl. 10.2)_: “Todos os Direitos de Propriedade Intelectual presentes no Aplicativo são da CGSSP.”
- ✓ _aviso de copyright (portal de privacidade)_: “© Copyright 2024 - DOTZ”

**robots.txt:** lido

### ABEMF
- **Classe D — sem termos de conteúdo** · fontes cadastradas: abemf (também fonte do Intelligence) · **NÃO habilitar**
- **Por quê:** Nenhum link de termos, privacidade ou direitos autorais no rodapé; só "© 2026 ABEMF ... Todos os direitos reservados". Associação: um pedido de autorização por escrito é caminho direto.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [outro] https://web.abemf.com.br/associados/ — leitor: lido; bruto: texto bruto lido (3658 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _aviso de copyright_: “© 2026 ABEMF - Associação Brasileira das Empresas do Mercado de Fidelização Todos os direitos reservados”

**robots.txt:** lido

### IDV — Instituto para Desenvolvimento do Varejo
- **Classe D — sem termos de conteúdo** · fontes cadastradas: idv · **NÃO habilitar**
- **Por quê:** Só política de privacidade e "© 2004 – 2026 ... Todos os direitos reservados". A sala de imprensa não foi aberta.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado (existe "Sala de imprensa", não aberta) |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [outro] https://www.idv.org.br/ — leitor: lido; bruto: texto bruto lido (3956 caracteres)
- [privacidade_apenas] https://www.idv.org.br/politica-de-privacidade — leitor: lido; bruto: texto bruto lido (9910 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _aviso de copyright_: “© 2004 – 2026 IDV Instituto para Desenvolvimento do Varejo. Todos os direitos reservados.”
- ✓ _aceitação de condições (texto da política de privacidade, não termos de conteúdo)_: “Ao navegar por nosso site e aplicativo, você concorda com todas as condições aqui expostas”

**robots.txt:** lido

### ABRAS
- **Classe D — sem termos de conteúdo** · fontes cadastradas: abras · **NÃO habilitar**
- **Por quê:** Só política de privacidade e "Todos os direitos reservados".

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado (existe /abras/imprensa, não aberta) |
| Automação, raspagem, IA | Não informado (robots.txt 404) |
| Atribuição | Não informado |

**Documentos:**
- [outro] https://www.abras.com.br/ — leitor: lido; bruto: texto bruto lido (3168 caracteres)
- [privacidade_apenas] https://www.abras.com.br/abras/politica-de-privacidade — leitor: lido; bruto: texto bruto lido (5818 caracteres)
- [outro] https://www.abras.com.br/abras/expediente — leitor: lido; bruto: texto bruto lido (2656 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _aviso de copyright (rodapé)_: “Todos os direitos reservados.”
- ✓ _links (links do portal para terceiros, política de privacidade)_: “No portal ABRAS existem diversos links para empresas com as quais mantemos algum tipo de relacionamento.”

**robots.txt:** nao_encontrado

### Brasscom
- **Classe D — sem termos de conteúdo** · fontes cadastradas: brasscom · **NÃO habilitar**
- **Por quê:** Só política de privacidade e "Todos os direitos reservados ©2025".

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [privacidade_apenas] https://brasscom.org.br/politica-de-privacidade/ — leitor: lido; bruto: texto bruto lido (3689 caracteres)
- [outro] https://brasscom.org.br/ — leitor: lido; bruto: texto bruto lido (6871 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _aviso_de_copyright (rodape)_: “Todos os direitos reservados ©2025 BRASSCOM | Orgulhosamente desenvolvido por Gim Digital”

**robots.txt:** lido

### ABRAREC
- **Classe D — sem termos de conteúdo** · fontes cadastradas: abrarec · **NÃO habilitar**
- **Por quê:** Só rodapé "© ABRAREC Todos os direitos reservados 2026".

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [outro] https://abrarec.com.br/ — leitor: lido; bruto: texto bruto lido (5758 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _aviso_de_copyright (rodape)_: “© ABRAREC Todos os direitos reservados 2026 | Desenvolvido por Navegar Marketing Digital”

**robots.txt:** lido

### Procon-SP
- **Classe D — sem termos de conteúdo** · fontes cadastradas: procon-sp · **NÃO habilitar**
- **Por quê:** Só o rodapé "© 2025 Fundação Procon – SP – Todos os direitos reservados"; a página de privacidade foi lida só em parte (~100 mil de ~270 mil caracteres).

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [privacidade_apenas] https://www.procon.sp.gov.br/privacidade-e-protecao-de-dados-lgpd/ — leitor: parcial; bruto: texto bruto lido (214151 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _aviso_de_copyright (rodape)_: “© 2025 Fundação Procon – SP – Todos os direitos reservados.”

**robots.txt:** lido

### Airlines for America (A4A)
- **Classe D — sem termos de conteúdo** · fontes cadastradas: a4a · **NÃO habilitar**
- **Por quê:** Só política de privacidade e "© 2026 ... All rights reserved". Existe o Product License Agreement de publications.airlines.org (não aberto).

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [privacidade_apenas] https://www.airlines.org/privacy/ — leitor: lido; bruto: texto bruto lido (13526 caracteres)
- [outro] https://www.airlines.org/ — leitor: lido; bruto: texto bruto lido (3934 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _aviso_de_copyright (rodape)_: “© 2026 Airlines for America (A4A). All rights reserved.”

**robots.txt:** lido

### Livelo (site e /imprensa)
- **Classe D — sem termos de conteúdo** · fontes cadastradas: livelo-imprensa (também fonte do Intelligence) · **NÃO habilitar**
- **Por quê:** Releitura de 23/11 com User-Agent identificado: site e /imprensa respondem 200 (o 403 de 22/11 era do cliente genérico; o Data Engineer chegou à mesma conclusão). O rodapé só leva a Regulamentos (regras do programa) e à Política de privacidade; não há termos de uso do site, só "Livelo S.A. Todos os direitos reservados". O robots.txt permite /imprensa.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [privacidade_apenas] https://www.livelo.com.br/politica-de-privacidade — leitor: lido; bruto: texto bruto lido (21547 caracteres)
- [outro] https://www.livelo.com.br/regulamentos — leitor: parcial; bruto: texto bruto lido (1325 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _aviso de copyright (rodapé)_: “Livelo S.A. Todos os direitos reservados”

**robots.txt:** lido

### Magazine Luiza (RI)
- **Classe D — sem termos de conteúdo** · fontes cadastradas: magalu-ri · **NÃO habilitar**
- **Por quê:** Releitura de 23/11 com User-Agent identificado: o RI responde 200 (a home www.magazineluiza.com.br segue 403 e não foi lida). Os Termos e Condições do RI afirmam titularidade, mas, ao contrário de Azul e GOL, não trazem vedação expressa de reprodução; também não autorizam.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado (o texto só afirma titularidade: o conteúdo pertence "a nós ou a terceiros que licitamente cederam seu direito de uso") |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [termos_de_uso] https://ri.magazineluiza.com.br/show.aspx?idMateria=r8+jnEVu1+FnJybGBWO3Uw== — leitor: lido; bruto: texto bruto lido (8626 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _titularidade do conteúdo (direitos de autor)_: “Salvo disposição em contrário, todo o conteúdo das páginas deste website, tais como informações, materiais, instrumentos, organização da página, gráficos e desenhos, pertencem a nós ou a terceiros que licitamente cederam seu direito de uso.”
- ✓ _aceitação dos termos_: “o usuário terá aceito automaticamente todos os Termos e Condições aqui estabelecidos”

**robots.txt:** lido

### Santander Brasil (RI)
- **Classe D — sem termos de conteúdo** · fontes cadastradas: santander-ri · **NÃO habilitar**
- **Por quê:** Releitura de 23/11 com User-Agent identificado: ri.santander.com.br responde 200, mas só traz política de privacidade e estatutos/códigos; termos de uso do site não localizados (a home do www não foi lida).

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | Não informado |
| Resumir/derivar | Não informado |
| Linkar | Não informado |
| Imagens/imprensa | Não informado |
| Automação, raspagem, IA | Não informado |
| Atribuição | Não informado |

**Documentos:**
- [privacidade_apenas] https://ri.santander.com.br/ri/politica-de-privacidade/ — leitor: lido; bruto: texto bruto lido (2307 caracteres)

**robots.txt:** lido

### Banco Central do Brasil
- **Classe E — inacessível / não lido** · fontes cadastradas: bcb · **NÃO habilitar até leitura manual dos termos**
- **Por quê:** Releitura de 23/11 com User-Agent identificado: a home responde 200, mas o conteúdo é JavaScript (2.866 caracteres) e /acessoinformacao/termosdeuso não existe: o termo oficial NÃO foi lido. O único aviso de reprodução ("reprodução total ou parcial sem fins lucrativos... citada a fonte") está numa página do BCB no Flickr, que NÃO é o termo oficial do site. Se for confirmado no site, ainda traz a condição "sem fins lucrativos", e o portal vende publicidade: ponto jurídico.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | NÃO LIDO no site oficial |
| Resumir/derivar | NÃO LIDO |
| Linkar | Aviso encontrado só em página do Flickr do BCB: links autorizados |
| Imagens/imprensa | NÃO LIDO |
| Automação, raspagem, IA | NÃO LIDO |
| Atribuição | Aviso (Flickr): citar a fonte |

**Documentos:**
- [outro] https://www.bcb.gov.br/ — leitor: inacessivel; bruto: nao_verificavel (página sem texto no HTML: 114 caracteres; provável JavaScript)
- [termos_de_uso] https://www.bcb.gov.br/acessoinformacao/termosdeuso — leitor: nao_encontrado; bruto: nao_verificavel (página sem texto no HTML: 114 caracteres; provável JavaScript)
- [direitos_autorais] https://www.flickr.com/photos/bancocentralbr/sets/72157655361202251 — leitor: parcial; bruto: texto bruto lido (1740 caracteres)

**Trechos literais citados (✓ conferido no HTML bruto):**
- ✓ _reproducao de texto / atribuicao / uso comercial (aviso em pagina do Flickr do BCB, nao no site bcb.gov.br)_: “É permitida a reprodução total ou parcial sem fins lucrativos do conteúdo deste site,”
- ✓ _atribuicao (mesmo aviso)_: “preservada a integridade das informações e citada a fonte.”
- ✓ _link para o site (mesmo aviso)_: “É autorizada também a inserção, em outros sites, de links para essa página.”

**robots.txt:** lido

### LATAM (RI) e LATAM Pass
- **Classe E — inacessível / não lido** · fontes cadastradas: latam-ir · **NÃO habilitar até leitura manual dos termos**
- **Por quê:** Releitura de 23/11 com User-Agent identificado: as páginas de termos (latamairlines.com e LATAM Pass) respondem 200, mas só renderizam por JavaScript (texto bruto de 29 e 3.107 caracteres): nada de termos lido. Precisa de leitura manual no navegador. O robots.txt lista agentes de IA com Allow: /llms.txt.

| Tópico | O que o texto diz |
|---|---|
| Citar/reproduzir texto | NÃO LIDO (página só renderiza por JavaScript) |
| Resumir/derivar | NÃO LIDO |
| Linkar | NÃO LIDO |
| Imagens/imprensa | NÃO LIDO |
| Automação, raspagem, IA | NÃO LIDO (o robots.txt foi lido: não bloqueia; só lista agentes de IA com Allow: /llms.txt) |
| Atribuição | NÃO LIDO |

**Documentos:**
- [termos_de_uso] https://www.latamairlines.com/us/en/legal/terms-of-use — leitor: parcial; bruto: nao_verificavel (página sem texto no HTML: 29 caracteres; provável JavaScript)
- [outro] https://latampass.latam.com/br/pt/regulamentos-gerais/termos-e-condicoes — leitor: parcial; bruto: texto bruto lido (3107 caracteres)

**robots.txt:** lido — aponta llms.txt e lista GPTBot, ChatGPT-User, PerplexityBot, ClaudeBot com Allow: /llms.txt (sem bloqueio total)

## DP-28 — decisão do proprietário (registrada em 23/11/2026) e o que ela libera

**O que a DP-28 diz** (conforme repassado pelo Program Manager; este arquivo não traz o texto original da decisão): fontes de mercado AUTORIZADAS, **com risco aceito pelo proprietário**, além de Senado, Câmara e EDPB — **citando e linkando a fonte, sem reproduzir além do necessário**. Limites que continuam valendo:
- `robots.txt` respeitado; **nunca contornar 403/429** (a fábrica já trata 429 como `rate_limited` e para);
- fontes **classe C** (o texto proíbe automação ou reprodução: Azul, GOL, ABECS, IATA, Nubank, Accor, Marriott, Salesforce, HubSpot, Zendesk, oneworld, ABAV — e, pela leitura deste dossiê, também Itaú) **só com revisão caso a caso, registrada**;
- Intelligence segue **fato + fonte + link + data, nunca o trecho**.

**O que muda neste dossiê:** a coluna "Recomendação" das classes A, B e D deixa de ser "NÃO habilitar" e passa a ser "pode ser habilitada, sob DP-28, depois da revisão humana no Studio" (abaixo). A DP-28 é aceitação de risco, **não** autorização do titular e **não** parecer jurídico: nenhum texto de classe D autoriza o reuso; apenas não o proíbe nos documentos lidos. Isso fica registrado na nota de revisão de cada fonte.

**Atenção — Intelligence:** a carga `seed.public.v2` traz uma "citação literal curta" por vínculo, e o `RoleMention` descrito em `docs/intelligence-handoff.md` carrega um `trecho` literal (≤ 500 caracteres) que a validação usa como prova do que foi dito. Pela DP-28 o Intelligence guarda só fato, fonte, link e data. Isso exige mudança no lado do Intelligence/Data e, no `RoleMention`, decidir se o trecho continua só como insumo de validação (descartado depois) — fora desta entrega; até lá, a exibição pública dessas citações continua suspensa.

### Fontes que podem ser habilitadas já (sob DP-28, com revisão humana no Studio)
"Já" = não exige alterar o cadastro: nível de pesquisa `lido` ou `parcial`, robots permitido na pesquisa, sem login/paywall conhecido. Cada uma ainda passa pela revisão humana abaixo (a revisão confere termos, URL, robots e paywall de novo no dia).

| Classe | Fontes (id) | Observações para o revisor |
|---|---|---|
| A | `senado-noticias`, `camara-noticias` | feeds confirmados; a rodada simulada de 23/11 coletou as duas sem bloqueio (Câmara respondeu 429 após rajada: coletar espaçado). Fotos/textos de terceiros republicados nas páginas não estão cobertos. |
| A | `edpb` | sem feed (deu 503): coleta por página. Exige atribuição e não distorcer o sentido. |
| B | `cvm`, `senacon`, `anac`, `mtur`, `anpd`, `mcti`, `anatel` | gov.br (licença com restrição, CC BY-ND). A DP-28 como repassada fala em "fontes de mercado"; a inclusão da classe B segue a lista do Program Manager. Manter reescrita curta de fatos, com link, sem reproduzir texto. `www.gov.br` é host compartilhado: cada fonte precisa do seu `pathPrefix` (já cadastrado). |
| D | `abemf`, `abrarec`, `a4a`, `brasscom`, `procon-sp` | **feed conferido em 23/11** (uma leitura por feed, UA identificado): ABEMF 10 itens (mais recente 22/10), ABRAREC 8 (19/11), A4A 10 (23/10), Brasscom 21 (04/11), Procon-SP 10 (19/11). |
| D | `bb-ri`, `bradesco-ri`, `idv` | sem feed; coleta pela página de listagem. |
| D | `febraban`, `abras` | exigem atenção do revisor: FEBRABAN com paywall "desconhecido" na pesquisa; ABRAS sem `robots.txt` lido na pesquisa. Só habilitar depois de conferir os dois pontos na revisão. |
| D (Intelligence) | `dotz`, hotsite Fidelidade/Livelo (`bradesco-ri`) | os Termos da Conta Dotz proíbem cópia do conteúdo **do aplicativo**; o site público não tem termos de conteúdo. Não usar conteúdo do aplicativo. |

**Classe D que ainda NÃO cabe "já":** `livelo-imprensa`, `magalu-ri` e `santander-ri` estão no cadastro com nível de pesquisa `inacessivel` (a pesquisa original recebeu 403). O handler **recusa** aprovar fonte inacessível. A releitura de 23/11 mostrou que as três respondem 200 com UA identificado, mas falta atualizar o cadastro (nível, robots, paywall e, no caso da Santander, endereço de listagem) — trabalho desta Frente, em commit à parte, que depois reabre a revisão.

**Classe C:** nenhuma habilitada. Entra só com revisão caso a caso: a nota da revisão (mín. 20 caracteres, o handler grava revisor, data e nota) deve começar por "CASO A CASO (DP-28):" e dizer qual cláusula do termo foi lida, por que o uso é aceito e quem aceitou. Itaú tem `Crawl-delay: 10` no robots.

**Classe E:** **nenhuma** teve o termo oficial lido, então nenhuma entra "já": BCB (home em JavaScript; o único aviso encontrado está numa página do BCB no Flickr e traz a condição "sem fins lucrativos"), LATAM/LATAM Pass (páginas de termos só renderizam por JavaScript), Star Alliance e ICO (403/desafio Cloudflare, não contornado). Precisam de leitura manual no navegador.

### Piloto de 10 matérias (Senado/Câmara + 2–3 fontes de mercado classe D)
Sugestão a partir dos feeds conferidos hoje: **ABEMF** (programas/pontos/mercado), **ABRAREC** (CRM) e **A4A** (global/mercado); reservas: Brasscom e Procon-SP. Ressalva: o feed da ABEMF tem 1 mês sem item novo e o da A4A, 1 mês; se a fonte não tiver matéria nova no dia, a rodada coleta menos (a fábrica não inventa).

### Fluxo de habilitação humana no Studio (`/studio/fontes/fabrica`)
O cadastro é imutável (toda fonte nasce `enabled=false`); o estado efetivo só muda por dois handlers, ambos auditados:
1. **Revisão** (papéis `admin`, `editor_chefe` ou `revisor`; sessão de staff com MFA): o revisor abre os termos oficiais e confere, no dia, termos, URL, `robots.txt` e paywall. Registra aprovada/negada, a **nota** do que leu (mín. 20 caracteres; para classes B/D, citar a DP-28 e a classe; para C, "CASO A CASO") e marca "URL verificada" e "robots conferido". **O revisor não pode ser o pesquisador da fonte.** Aprovar é recusado com paywall/login ou se a fonte estiver `inacessivel` na pesquisa. A revisão **não habilita**.
2. **Habilitação** (`admin` ou `editor_chefe`): exige revisão registrada, **atual** (se a definição da fonte mudou, a revisão vence), aprovada e a fonte elegível (termos aprovados, URL verificada, sem paywall, robots respeitado, `pathPrefix` quando o host é compartilhado). Desabilitar é sempre permitido, também para `revisor`.
3. Com a fonte habilitada, a coleta ainda depende da flag `editorialCollector`; a redação depende de `editorialPipeline` e de `modelosHabilitados`; a publicação, de `publicacaoPortal`.
4. Qualquer mudança da definição da fonte, nova revisão ou termo alterado **desliga** a habilitação até nova revisão.

Checklist do revisor (classes B/D): (a) reabrir a página de termos e confirmar que nada novo proíbe; (b) abrir `robots.txt` e conferir o caminho do feed/listagem; (c) abrir uma matéria e confirmar que não há login/paywall; (d) anotar na nota "DP-28, classe X, risco aceito pelo proprietário"; (e) não habilitar fonte cuja matéria traga imagem ou texto de terceiro sem crédito (regra D08: nenhuma foto sem base de direito).

## Fontes do Intelligence (carga `seed.public.v2`) — situação
A carga usa 6 páginas públicas como evidência de vínculos entre organizações, com **citação literal curta** por registro. Situação dos termos de cada uma:
| Página usada pelo Intelligence | Termos | Situação |
|---|---|---|
| Livelo — /imprensa | releitura de 23/11: site e /imprensa respondem 200; rodapé só leva a Regulamentos e Privacidade, sem termos de conteúdo | classe D |
| Bradesco — hotsite Fidelidade/Livelo | sem termos de conteúdo localizados | classe D |
| LATAM Pass — Conheça o programa | releitura de 23/11: responde 200, mas o termo só renderiza por JavaScript (nada de termos lido) | classe E |
| ABEMF — home e Empresas Associadas | sem termos localizados | classe D |
| Dotz — home | só Termos da Conta Dotz (aplicativo) | classe D |
Observação: a carga atual guarda nome, relação e **trecho literal curto** como evidência; nenhum desses sites autoriza nem proíbe isso no texto lido. **Pela DP-28 o Intelligence passa a guardar só fato + fonte + link + data, nunca o trecho** — a carga precisa mudar (fora desta Frente) e a exibição pública das citações atuais continua suspensa.

## O que fica para o proprietário decidir (R0-10)
1. **Primeira matéria real:** Senado/Câmara (e EDPB) habilitáveis, com a revisão humana da fonte no Studio. O `robots.txt` da Câmara foi conferido na rodada simulada de 23/11 (35 regras por agente de IA, nenhuma sobre feed ou matérias); fotos/textos de terceiros nessas páginas continuam fora do que foi lido.
2. **gov.br (CVM, ANPD, Senacon...) e BCB:** pedir parecer sobre CC BY-ND (a reescrita de fatos com citação é "derivação"?) e sobre o aviso do BCB com "sem fins lucrativos" (o portal vende publicidade). Antes, fazer a leitura manual dos termos oficiais do BCB e dos demais órgãos gov.br.
3. **Empresas e associações:** **classe D — decidido pela DP-28** (risco aceito, habilitação pelo Studio). **Classe C (Azul, GOL, ABECS, IATA, Nubank, Accor, Marriott, Salesforce, HubSpot, Zendesk, oneworld, ABAV, Itaú):** o texto proíbe a reprodução e/ou a coleta automatizada; só com revisão caso a caso registrada ou autorização escrita do titular.
4. **Sem termo lido (classe E: BCB, LATAM/LATAM Pass, Star Alliance, ICO):** alguém precisa abrir os termos no navegador; a fábrica não contorna bloqueios. Magalu (RI), Livelo, Itaú e Santander (RI) foram lidos na releitura de 23/11 e já não estão nesta lista.
5. **Imagens:** nenhuma fonte lida libera imagens de imprensa de forma geral (exceções textuais: Senado e Câmara reproduzem fotos/dados com crédito; HubSpot libera imagens originais suas). Regra D08 mantida: sem foto sem base de direito registrada.

## Dados brutos
`docs/termos-fontes.data.json` junta o que cada leitor devolveu e o resultado da conferência contra o HTML bruto (por documento e por trecho). Reproduzível: os scripts de leitura/conferência não fazem parte do repositório; a conferência é uma leitura GET por documento.
