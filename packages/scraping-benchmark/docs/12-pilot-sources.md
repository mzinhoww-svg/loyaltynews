# 12 — Relatório por fonte do piloto (tarefa 17)

Gerado em 2026-11-24T12:33:53.396Z sobre a int/019 (7fd57ac) por `scripts/pilot-report.ts`; dados em `data/pilot/pilot-report.json`. **Chamadas tarifadas: 0. Chaves usadas: 0.** Só leituras diretas de páginas públicas (35 no total, em 4 execuções: as seguintes refizeram só as fontes corrigidas — Livelo, Febraban, CVM e ANAC), com ritmo de pelo menos 3,5 s por host, uma requisição por vez e a guarda contra SSRF. Ficam gravados só métricas, títulos, datas e hashes (DP-29). Nenhuma fonte foi habilitada; o cadastro segue `desabilitada`.

Critério de matéria válida: o v2 do benchmark (texto com pelo menos 600 caracteres, título igual ao do feed com similaridade de pelo menos 0,5, sem login, paywall ou desafio). Sem título de referência, como no sitemap sem `news:title` ou na listagem, o título não é verificável e a matéria vale por texto de pelo menos 600 caracteres, pelo menos 1 parágrafo de 200 ou mais caracteres e ausência de paywall. Paywall: `detectWall` com os marcadores por token da R5 (5cff1d0).

| Fonte | Classe | Método | Descoberta (HTTP; itens; com data; ≤ 7 d) | Matérias lidas | Válidas v2 | Título confere | Data confere | Paywall/login (R5) | Maior parágrafo (car.) |
|---|---|---|---|---:|---:|---|---|---|---|
| Agência Senado | A | rss/atom | 200; 15; 15; 15 | 2 | 2 | 2/2 | 2/2 | 0 detecções | 426 / 274 |
| Câmara dos Deputados — Câmara Notícias | A | rss/atom | 200; 20; 20; 20 | 2 | 2 | 2/2 | — | 0 detecções | 493 / 1189 |
| ABEMF (Associação Brasileira das Empresas de Marketing de Fidelidade) | D | rss/atom | 200; 10; 10; 0 | 2 | 2 | 2/2 | 2/2 | 0 detecções | 776 / 684 |
| Livelo — Imprensa | D | sitemap | 200; 669; 669; 66 | 2 | 2 | não verificável | — | 0 detecções | 4645 / 7501 |
| ABRAREC (Associação Brasileira das Relações Empresa Cliente) | D | rss/atom | 200; 8; 8; 4 | 2 | 2 | 2/2 | 2/2 | 0 detecções | 271 / 271 |
| FEBRABAN | D | listagem HTML (sem feed/sitemap) | 200; 1; 0; 0 | 1 | 1 | 1/1 | — | 0 detecções | 420 |
| CVM — notícias | seed | rss/atom | 404; 0; 0; 0 | 0 | 0 | não verificável | — | — | — |
| ANAC — notícias | seed | sitemap | 200; 5000; 5000; 18 | 2 | 1 | não verificável | 0/1 | 0 detecções | 392 / 0 |

## Fixtures locais (sem rede)

- `packages/editorial/fixtures/anac-sitemap1/sitemap1-http.sample.xml`: sitemap, 7 itens, 7 com data; o parser do benchmark lê sem erro.
- `packages/editorial/fixtures/anac-sitemap1/sitemap1-https.sample.xml`: sitemap, 7 itens, 7 com data; o parser do benchmark lê sem erro.

## Leitura

- **Prontas pelo método previsto, só com leitura direta, sem provedor:** Senado e Câmara (RSS), ABEMF e Abrarec (RSS) e Livelo (sitemap filtrado em `/imprensa/`), todas com 2 de 2 válidas e nenhuma detecção de login ou paywall.
- **ANAC** (sitemap `.xml.gz`, 5.000 URLs): o sitemap mistura notícias, listagens e PDFs. Filtrado em `/noticias/` e sem PDF, deu 1 de 2: a matéria foi válida e a 2ª URL era uma página de listagem, reprovada corretamente (sem parágrafo longo). A descoberta precisa de filtro de caminho mais estrito (`/pt-br/noticias/AAAA/`) ou do RSS, se existir.
- **Febraban:** sem feed nem sitemap. A listagem HTML rendeu só 1 link de matéria, que foi lido com sucesso. A descoberta é frágil. Alternativa: busca Exa restrita ao domínio, cerca de US$ 0,004 por busca, tarifada e não usada aqui.
- **CVM:** o feed `/2026/rss.xml` do cadastro e o `/RSS` raiz deram **404** em 24/11, contra 200 no feed de 2026 em 23/11. A causa não foi verificada: pode ser mudança no site ou recusa ao nosso UA. Não insisti. A Editorial precisa reconferir antes de habilitar.
- **Ritmo e conformidade:** no máximo 4 requisições por host, abaixo do limite por hora do cadastro de cada fonte. A DP-32 não foi usada: nenhum desbloqueio, nenhum provedor.

## Limites

- São 2 matérias por fonte: evidência de funcionamento, não estatística.
- A similaridade de título é automática, contra o título do feed; não há rotulagem humana.
- As leituras da 1ª execução (Senado, Câmara, ABEMF e Abrarec) usaram o critério sem a exigência de parágrafo longo, que só vale quando não há título de referência. Essas 4 fontes têm título de referência, então o resultado não muda.
