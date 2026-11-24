# Dossiê de habilitação das fontes do piloto (reconferido em 24/11/2026)

> **Atualização 24/11 (DP-49): o proprietário AUTORIZOU habilitar as 5 fontes.** A habilitação ainda **não foi feita**: o admin a faz no Studio quando o staging voltar (não é feita pela Editorial). Até lá **nenhuma fonte está habilitada**: as cinco continuam com `enabled: false` no cadastro (o teste `src/tests/dossie-habilitacao.test.ts` confere). Habilitar é ato humano no Studio (`/studio/fontes/fabrica`): revisão por pessoa diferente da pesquisadora (`ln-editorial-engineer`) e habilitação por admin ou editor-chefe, com MFA. Passo a passo de 1 página: `docs/piloto-checklist-habilitacao.md`. Dados estruturados: `docs/dossie-habilitacao-piloto.data.json`.

## Uma linha por fonte

| Fonte (id) | Classe | Termos (link) | robots.txt | Feed ou sitemap | Evidência de URL (listagem) | Limite por hora · espaçamento | Conferido em |
|---|---|---|---|---|---|---|---|
| Agência Senado (`senado-noticias`) | A | [1](https://www12.senado.leg.br/noticias/politica-de-uso) | [200](https://www12.senado.leg.br/robots.txt): listagem e entrada permitidas | [feed](https://www12.senado.leg.br/noticias/rss.xml): feed 200, 15 itens, mais recente 24/11/2026 | [200](https://www12.senado.leg.br/noticias): "Senado Notícias" | 6/h · 3 s · 1 rodada/dia | 24/11/2026 |
| Câmara Notícias (`camara-noticias`) | A | [1](https://www2.camara.leg.br/termo-de-uso-e-politica-de-privacidade) | [200](https://www.camara.leg.br/robots.txt): listagem e entrada permitidas | [feed](https://www.camara.leg.br/noticias/rss/ultimas-noticias): feed 200, 20 itens, mais recente 24/11/2026 | [200](https://www.camara.leg.br/noticias/): "Agência Câmara de Notícias - Portal da Câmara dos Deputados" | 6/h · 3 s · 1 rodada/dia | 24/11/2026 |
| ABEMF (`abemf`) | D | [1](https://web.abemf.com.br/associados/) | [200](https://web.abemf.com.br/robots.txt): listagem e entrada permitidas | [feed](https://web.abemf.com.br/feed/): feed 200, 10 itens, mais recente 22/10/2026 | [200](https://web.abemf.com.br/noticias/): "Notícias – ABEMF" | 6/h · 3 s · 1 rodada/dia | 24/11/2026 |
| Livelo (imprensa) (`livelo-imprensa`) | D | [1](https://www.livelo.com.br/politica-de-privacidade) · [2](https://www.livelo.com.br/regulamentos) | [200](https://www.livelo.com.br/robots.txt): listagem e entrada permitidas | [sitemap](https://www.livelo.com.br/sitemap/static-sitemap-0.xml): sitemap 200, 669 URLs (37 em /imprensa/), mais recente 26/08/2026 | [200](https://www.livelo.com.br/imprensa): "Tudo vira pontos. Pontos viram tudo." | 6/h · 3 s · 1 rodada/dia | 24/11/2026 |
| ABRAREC (`abrarec`) | D | [1](https://abrarec.com.br/) · [2](https://abrarec.com.br/politica-de-privacidade/) | [200](https://abrarec.com.br/robots.txt): listagem e entrada permitidas | [feed](https://abrarec.com.br/feed/): feed 200, 8 itens, mais recente 23/11/2026 | [200](https://abrarec.com.br/blog/): "Notícias – ABRAREC" | 6/h · 3 s · 1 rodada/dia | 24/11/2026 |

**Termos lidos (a página abre e o trecho do dossiê de termos continua lá):**

- `senado-noticias` — [politica_de_uso](https://www12.senado.leg.br/noticias/politica-de-uso): HTTP 200; 2 trecho(s) conferido(s) na página.
- `camara-noticias` — [termo_de_uso](https://www2.camara.leg.br/termo-de-uso-e-politica-de-privacidade): HTTP 200; 3 trecho(s) conferido(s) na página.
- `abemf` — [rodape_sem_termos (página lida)](https://web.abemf.com.br/associados/): HTTP 200; 1 trecho(s) conferido(s) na página.
- `livelo-imprensa` — [privacidade_apenas](https://www.livelo.com.br/politica-de-privacidade): HTTP 200; 1 trecho(s) conferido(s) na página.
- `livelo-imprensa` — [regulamentos_do_programa](https://www.livelo.com.br/regulamentos): HTTP 200; releitura manual em 24/11: 200, "Regulamentos Livelo".
- `abrarec` — [rodape_sem_termos (página lida)](https://abrarec.com.br/): HTTP 200; 1 trecho(s) conferido(s) na página.
- `abrarec` — [privacidade_apenas](https://abrarec.com.br/politica-de-privacidade/): HTTP 200; 1 trecho(s) conferido(s) na página.

## Ressalvas por fonte (o revisor lê antes de aprovar)

**Agência Senado (`senado-noticias`, classe A)**
- Sem Crawl-delay no robots.txt; o coletor usa o espaçamento padrão de 3 s.
- O revisor reabre a política de uso no dia (os termos mudam).

**Câmara Notícias (`camara-noticias`, classe A)**
- O robots.txt tem 28 grupos de agentes; o Crawl-delay: 10 é só de bingbot, msnbot e Slurp. Para o nosso agente (grupo *) vale o espaçamento padrão de 3 s. Com o limite de 6 requisições por hora do cadastro, uma rodada rende cerca de 4 matérias (robots, feed e as páginas).
- Respondeu 429 em rajada em 23/11: no máximo 1 rodada por dia; a coleta para no primeiro 429.

**ABEMF (`abemf`, classe D)**
- O feed está parado: a matéria mais recente é de 22/10/2026 (33 dias); a fonte pode não render matéria nova.
- Classe D: nenhum termo de conteúdo; o rodapé só traz "direitos reservados" (o trecho do cadastro tem reticências e não é literal; a página confere "ABEMF" e "todos os direitos reservados").

**Livelo (imprensa) (`livelo-imprensa`, classe D)**
- Sem feed: coleta por sitemap (37 páginas de /imprensa/; a mais recente é de 26/08/2026).
- Paywall: nenhum. O proprietário confirmou na DP-49 (24/11/2026) que não há paywall, só login (área da conta). A coleta fica só nas páginas públicas de /imprensa/ (sitemapPathPrefix) e nunca atrás do login; se uma página pedir login, o coletor para (`gated`) e não insiste. O revisor marca paywall "nenhum" no Studio.
- Classe D: o rodapé só leva a Regulamentos e Privacidade, e nenhum dos dois trata de reprodução de conteúdo.

**ABRAREC (`abrarec`, classe D)**
- Classe D: nenhum termo de conteúdo (rodapé de direitos reservados e política de privacidade).
- Feed atual: 8 itens, o mais recente de 23/11/2026.

## O que a reconferência de 24/11 mudou em relação a 23/11

- **Câmara:** o `robots.txt` tem 28 grupos de agentes e um `Crawl-delay: 10`, mas ele é só de `bingbot`, `msnbot` e `Slurp`; o grupo `*` não tem. Vale o espaçamento padrão de 3 s. Um alarme falso meu da primeira passada (li o arquivo sem separar os grupos).
- **ABEMF:** o feed segue parado desde 22/10/2026 (mais 1 dia sem matéria nova).
- **FEBRABAN (fora do piloto, sem mudança de decisão):** o `robots.txt` agora declara `Sitemap: https://portal.febraban.org.br/sitemap.xml`; antes não declarava. Não li o sitemap nem os termos novamente; vale reavaliar depois do piloto, não agora.
- As outras fontes: sem diferença (feeds e sitemap respondem 200; termos abrem; trechos literais presentes).

## Como foi conferido (e o que não foi)

Uma leitura por URL (`robots.txt`, feed ou sitemap, listagem e páginas de termos), User-Agent identificado (`LoyaltyNewsSourceVerifier/1.0`, verificação pontual), 3,3 s ou mais entre leituras ao mesmo host, parada no 429/403/desafio. **Nenhuma matéria foi coletada, nada foi habilitado e não houve custo.** A heurística de parada do meu script deu um falso positivo no segundo link de termos do Livelo (`/regulamentos`); li de novo à mão (200, "Regulamentos Livelo"), por isso essa página e o rodapé da ABEMF (cujo trecho do cadastro tem reticências e não é literal) foram conferidos fora do script. **Não conferi:** o texto integral dos termos além dos trechos citados (o revisor humano reabre cada link no dia), nem se uma matéria específica traz aviso de direito próprio.

## Notas de revisão para colar no Studio (≥ 20 caracteres; cada uma já traz a data da reconferência)

**Agência Senado (`senado-noticias`)**

> Termos da Agência Senado (política de uso) lidos em 23/11/2026: reprodução livre sem descaracterizar, com citação da Agência Senado e do autor; robots.txt conferido (sem regras para o agente); sem login nem paywall; classe A (docs/termos-fontes.md); DP-28. Reconferido em 24/11/2026: termos acessíveis, robots.txt sem bloqueio do caminho de coleta, feed respondendo 200. Autorizada pelo proprietário na DP-49 (24/11/2026).

**Câmara Notícias (`camara-noticias`)**

> Termo de uso do Portal da Câmara lido em 23/11/2026 (itens 7 e 29: trechos entre aspas, informações de domínio público, citar a Câmara e a autoria); robots.txt conferido (feed e /noticias permitidos); sem login nem paywall; classe A; DP-28. Reconferido em 24/11/2026: termos acessíveis, robots.txt sem bloqueio do caminho de coleta, feed respondendo 200. Autorizada pelo proprietário na DP-49 (24/11/2026).

**ABEMF (`abemf`)**

> DP-28, classe D, risco aceito pelo proprietário; site sem termos de conteúdo (só rodapé de direitos reservados, lido em 23/11/2026); robots.txt conferido (/noticias/ e /feed/ permitidos); sem login nem paywall. Reconferido em 24/11/2026: termos acessíveis, robots.txt sem bloqueio do caminho de coleta, feed respondendo 200. Autorizada pelo proprietário na DP-49 (24/11/2026).

**Livelo (imprensa) (`livelo-imprensa`)**

> DP-28, classe D, risco aceito pelo proprietário; rodapé só com Regulamentos e Privacidade (lidos em 23/11/2026); robots.txt permite /imprensa; coleta por sitemap /imprensa/; paywall: nenhum (o proprietário confirmou na DP-49 que não há paywall, só login na área da conta; a listagem /imprensa respondeu 200 sem tela de login em 24/11/2026; a coleta fica nas páginas públicas de /imprensa/ e nunca atrás do login). Reconferido em 24/11/2026: termos acessíveis, robots.txt sem bloqueio do caminho de coleta, sitemap respondendo 200. Autorizada pelo proprietário na DP-49 (24/11/2026).

**ABRAREC (`abrarec`)**

> DP-28, classe D, risco aceito pelo proprietário; sem termos de conteúdo (rodapé de direitos reservados e política de privacidade, lidos em 23/11/2026); robots.txt conferido (/blog/ e /feed/ permitidos); sem login nem paywall. Reconferido em 24/11/2026: termos acessíveis, robots.txt sem bloqueio do caminho de coleta, feed respondendo 200. Autorizada pelo proprietário na DP-49 (24/11/2026).

## Decisão do proprietário (DP-49, 24/11/2026) e como habilitar

**Registrada em `r0-preparacao/decisoes-proprietario-2026-11-22.md` (DP-49):** o proprietário autorizou habilitar as 5 fontes do piloto: Agência Senado, Câmara Notícias, ABEMF, ABRAREC e Livelo imprensa. ABEMF, ABRAREC e Livelo entram pelo aceite de risco da DP-28 (classe D, sem termo de conteúdo; **não há autorização do titular**). **Livelo: sem paywall, só login; a coleta fica nas páginas públicas de /imprensa/, nunca atrás do login** (o cadastro agora traz paywall "nenhum"; o coletor só lê o prefixo /imprensa/ do sitemap e para se uma página pedir login).

**Quem e quando:** o admin (ou o editor-chefe), com MFA, em `/studio/fontes/fabrica`, **quando o staging voltar**; em duas etapas por fonte (revisar colando a nota abaixo; depois habilitar); não pode ser a pesquisadora das fontes (`ln-editorial-engineer`). Desabilitar vale na hora. **Habilitar não coleta nada:** a coleta só roda com as flags `editorialCollector` e `editorialPipeline` ligadas (DevOps/PM) e o piloto só depois da Fase 3 (banco no staging) e da flag `openbotDispatch`. Nenhuma imagem de fonte é usada.

**Recomendação por fonte (já aprovada pelo proprietário):** Senado, Câmara, ABRAREC: habilitar. ABEMF: habilitar, sem esperar matéria nova (feed parado desde 22/10). Livelo: habilitar com paywall "nenhum" (DP-49), coletando só /imprensa pública. Câmara: 1 rodada por dia (responde 429 em rajada).

Fora do piloto (não habilitar): FEBRABAN, qualquer fonte de classe C ou E, os blogs e as fontes "via provedor". As 10 fontes seguintes, para depois do piloto, estão em `docs/fontes-pos-piloto.md`.
