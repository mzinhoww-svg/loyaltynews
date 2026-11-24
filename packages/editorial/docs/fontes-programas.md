# Sites oficiais dos programas de fidelidade no banco de fontes (DP-51, conferido em 24/11/2026)

> Decisão do proprietário (DP-51): o banco de fontes passa a ter o **site oficial de cada programa**, além de RI e sala de imprensa, **só páginas públicas**, e todas as fontes habilitadas no staging. Esta entrega acrescenta ao seed (`src/sources/seed-programas.ts`, kind novo `loyalty_program`) **8 fontes**: 5 coletáveis por sitemap e 3 só de cadastro. **Nenhuma está habilitada** (`enabled: false`): o admin habilita no Studio depois que entrarem no staging. Leitura de pesquisa: uma leitura por URL, User-Agent identificado, 3,3 s ou mais por host, parada em 403/429/desafio (não contornado); nada coletado além de uma página de amostra por site.

## O que entrou

| Fonte (id) | Programa e seção | Entrada de coleta | Limite/h | O que foi conferido (24/11) |
|---|---|---|---|---|
| `smiles-conteudo` | Smiles, hub "Te levo de milhas" (destinos, pílulas financeiras, mercado de fidelidade) | sitemap `https://www.smiles.com.br/sitemap.xml`, prefixo `/te-levo-de-milhas/` (25 páginas, 22 com lastmod desde 15/10) | 8 | robots 200 (grupo `*` só proíbe URL com parâmetro e PDF); páginas de amostra com texto visível, sem login; termos lidos (regulamento do app e privacidade) sem cláusula de automação |
| `latampass-novidades` | LATAM Pass, novidades do programa | sitemap do Brasil `https://latampass.latam.com/br/pt.sitemap.xml`, prefixo `/br/pt/novidades` (1 página hoje) | 14 | robots 200, sem regra de bloqueio; página com texto visível, sem login |
| `latampass-regulamentos` | LATAM Pass, regulamentos | mesmo sitemap, prefixo `/br/pt/regulamento` (4 páginas) | 14 | idem; termos e condições lidos (3 mil caracteres) sem cláusula de automação |
| `livelo-programa` | Livelo, páginas do programa (como juntar pontos: parceiros e instituições financeiras) | `https://www.livelo.com.br/sitemap/static-sitemap-0.xml`, prefixo `/juntar-pontos/` (25 páginas) | 20 | robots 200 (só `/api/`, `/autologin`, `/logout`, `/redirect-login-page` bloqueados); DP-49: **sem paywall, só login (área da conta)**; coleta só pública |
| `esfera-campanhas` | Esfera (Santander), campanhas | `https://www.esfera.com.vc/staticSitemap.xml`, prefixo `/campanha-` (36 páginas) | 8 | robots 200 (bloqueia carrinho, checkout, perfil, busca); páginas de aplicação de página única com pouco texto (cerca de 700 caracteres) |
| `dotz-site` | Dotz, site do programa | **nenhuma** (só cadastro) | 6 | robots 200 sem bloqueio; o site é de página única (63 caracteres de texto no HTML) e o sitemap tem 14 páginas estáticas de 2023 no domínio sem www |
| `km-de-vantagens` | Km de Vantagens (Ipiranga), página do programa | **nenhuma** (só cadastro) | 6 | robots 200 em `www.ipiranga.com.br`; a página tem 11 mil caracteres de texto, sem login; o sitemap fica em outro host (`portal.ipiranga`) e não tem seção de notícias |
| `petrobras-premmia` | Premmia (Petrobras), página do programa | **nenhuma** (só cadastro) | 6 | robots 200 em `www.postospetrobras.com.br` (o endereço antigo `petrobraspremmia.com.br` redireciona); 3,4 mil caracteres de texto, sem login; sem sitemap declarado |

As três "só cadastro" aparecem no Studio e na lista de fontes, mas a coleta devolve `no_feed` (sem erro) e **nada é requisitado** delas até haver feed, sitemap ou leitura via provedor (decisão do proprietário, DP-31/DP-32; esta rodada usa só o coletor direto, que respeita o `robots.txt`).

## O que NÃO entrou (e por quê; nada foi contornado)

| Programa | Motivo (24/11) |
|---|---|
| Azul Fidelidade / TudoAzul | `tudoazul.voeazul.com.br` e `azulfidelidade.com.br` não resolvem (ENOTFOUND/timeout); `www.voeazul.com.br/br/pt/home` respondeu **403** (parei); o sitemap de `voeazul.com.br` é um índice de 128 filhos misturados (ofertas de teste, outros países), sem seção de novidades do programa |
| C6 Átomos | `www.c6bank.com.br/robots.txt` respondeu **403**: sem robots lido não coleta (fail closed); não contornado |
| Itaú (Iupp) | `www.iupp.com.br` não abriu (timeout de conexão); não verificável |
| Multiplus (legado) | `multiplusfidelidade.com.br` redireciona para `latampass.com` (programa encerrado e absorvido pelo LATAM Pass) |
| Inter (Loop) | o sitemap de `inter.co` tem 1.423 URLs, quase todas de investimentos; `/loop/` dá 404; sem seção do programa |
| Mastercard (Surpreenda) | sem sitemap; fora do escopo de programa próprio |
| Stix | o site está "em evolução" (27 caracteres de texto), sem feed, sem sitemap, `/blog` 404 |

Quando um deles tiver endereço, robots e seção pública verificáveis, entra com o mesmo molde (um commit de seed + teste).

## Regras que o código impõe (testadas)

- **Nunca atrás de login ou paywall:** só entram prefixos públicos do sitemap; se uma página pedir login o coletor para (`gated`, 2 seguidas); o teste confere que nenhuma requisição vai a endereço de login/conta/checkout.
- **Até 5 páginas por rodada por fonte** de sitemap (`SITEMAP_MAX_PAGES_PER_RUN`), 3 s entre requisições, parada em 429/403/desafio e o limite por hora do cadastro.
- **Limite por hora cobre a rodada completa:** 1 `robots.txt` + 1 sitemap + 5 páginas = 7 requisições; Smiles e Esfera têm 8/h (com 6, a quinta página saía em `rate_limited`: achado do QA 10 sobre o primeiro commit).
- **Janela por host:** a janela de 1 h é do host. LATAM Pass (2 fontes, host dividido) tem 14/h por fonte (1 robots + 2 × (1 sitemap + 5 páginas) = 13) e a Livelo (imprensa 6/h + programa 20/h) cobre a rodada conjunta; o teste faz a conta para qualquer host dividido.
- **Entradas corrompidas viram aviso, não coleta:** o sitemap real da Esfera traz URLs com host concatenado (`https://www.esfera.com.vchttps://esfera.zendesk.com/…`): o coletor as descarta e avisa (`sitemap_entries_dropped`, `loc_url_embutida`), nunca as requisita.
- **Só fato, fonte, link e data** (DP-29): a fábrica reescreve, nunca reproduz o regulamento ou o texto de campanha; nenhuma imagem de fonte (D08).

## Termos e classe

Nenhuma das páginas de termos lidas (LATAM Pass termos e condições, Smiles regulamento do app e privacidade, Livelo regulamentos) tem cláusula sobre automação, extração ou reprodução do conteúdo do site: **classe D provisória** (sem termo de conteúdo; vale a aceitação de risco da DP-28, ampliada pela DP-51). Esfera: os regulamentos ficam no Zendesk da Esfera (outro host): link registrado, **não lido**. Dotz, Km de Vantagens e Premmia: termos do site não localizados. Isso **não é parecer jurídico** nem autorização do titular.

## Riscos e limites conhecidos

- **Smiles:** o sitemap tem 1,6 MB e o limite de leitura do coletor é 2 MB; se o arquivo passar disso a leitura da Smiles falha (sem coletar nada) até alguém subir o limite do fetcher para sitemaps.
- **LATAM Pass:** o sitemap do Brasil tem o mesmo lastmod em todas as 126 URLs (24/11), então a data não ordena; por isso os dois prefixos são estreitos.
- **Esfera:** pouco texto por página (aplicação de página única); rende pouco.
- **Rodada:** com 5 páginas por fonte e as janelas acima, uma rodada conjunta de todas as fontes dos programas faz no máximo cerca de 29 requisições em 4 hosts (Smiles 7, LATAM Pass 8, Livelo 7, Esfera 7), sempre espaçadas.

## Como entra no staging (e o que NÃO dá para fazer sem redeploy)

- As **definições** das fontes são código (`SEED_SOURCES`, lido pelo Studio e pelo worker): **entrar no staging exige o deploy normal** (web e workers) do commit desta branch; **não há migração** (nenhuma tabela nova) e não existe hoje um banco de definições de fonte que permita acrescentar fonte em runtime. Criar essa tabela seria uma migração e uma mudança de contrato: fica como opção, não foi feito.
- O **estado** (habilitada ou não, revisão) já fica no banco (`editorial_source_state`): depois do deploy, o admin habilita no Studio (com a mudança da DP-51 de habilitação direta, que é de outra frente). Sem script novo.
- Enquanto uma fonte estiver habilitada mas as flags `editorialCollector`/`editorialPipeline` estiverem desligadas, nada é coletado.
