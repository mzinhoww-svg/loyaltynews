# Termos e habilitação das fontes do piloto de 10 matérias (trilha C, DP-28)

Escopo: Senado, Câmara e fontes de mercado classe D. Dados estruturados em `docs/piloto-fontes.data.json` (um teste confere cada linha contra o cadastro e o dossiê); dossiê completo dos termos em `docs/termos-fontes.md`. Não é parecer jurídico: registra o que o texto oficial diz e o que a DP-28 (risco aceito pelo proprietário) cobre.

## Estado e quem decide

- **Nenhuma fonte está habilitada no cadastro** (`enabled: false`, termos `pending`). A coluna "Recomendação" é da Editorial; **habilitar é ato humano** em `/studio/fontes/fabrica`: revisão por pessoa **diferente da pesquisadora** (`ln-editorial-engineer`) e habilitação por `admin` ou `editor-chefe`, com MFA. A nota de revisão sugerida de cada fonte está no `.data.json`.
- Nada de coleta real em produção nem custo: a coleta só roda com as flags `editorialCollector` e `editorialPipeline` ligadas; hoje estão desligadas.

## Resumo

| Fonte (id) | Classe | Listagem / como coleta | Termos lidos (data) | Pode coletar | Pode reproduzir | Frequência no piloto | Recomendação |
|---|---|---|---|---|---|---|---|
| Agência Senado (`senado-noticias`) | A | [/noticias](https://www12.senado.leg.br/noticias); feed `rss.xml` | [política de uso](https://www12.senado.leg.br/noticias/politica-de-uso) (23/11/2026) | Sim; robots sem regra para nosso agente | Reprodução livre sem descaracterizar, citando a Agência Senado e o autor | 1 rodada/dia, até 5 matérias | **Habilitar** |
| Câmara Notícias (`camara-noticias`) | A | [/noticias/](https://www.camara.leg.br/noticias/); feed `ultimas-noticias` | [termo de uso](https://www2.camara.leg.br/termo-de-uso-e-politica-de-privacidade) (23/11/2026) | Sim; robots libera feed e matérias, inclusive para agentes de IA | Trechos entre aspas; informações de domínio público; citar "Câmara dos Deputados" e autoria | 1 rodada/dia, até 5 matérias; **nunca em rajada (HTTP 429)** | **Habilitar** |
| ABEMF (`abemf`) | D | [/noticias/](https://web.abemf.com.br/noticias/); feed `/feed/` (10 itens, último 22/10) | só rodapé "Todos os direitos reservados" ([associados](https://web.abemf.com.br/associados/), 23/11/2026) | Sem termo que autorize ou proíba; robots libera | Nada autorizado; DP-28 aceita o risco; só reescrita + link | 1 rodada/dia, até 3 matérias | **Habilitar** (DP-28) |
| Livelo imprensa (`livelo-imprensa`) | D | [/imprensa](https://www.livelo.com.br/imprensa); sitemap `/imprensa/` (37 páginas; última de 26/08) | [privacidade](https://www.livelo.com.br/politica-de-privacidade) e [regulamentos](https://www.livelo.com.br/regulamentos) (23/11/2026); sem termo de conteúdo | Sem termo que autorize ou proíba; robots permite /imprensa | Nada autorizado; DP-28; só reescrita + link | 1 rodada/dia, até 2 matérias | **Habilitar** (DP-28 e DP-49; sem paywall, só login: coletar só /imprensa pública) |
| ABRAREC (`abrarec`) | D | [/blog/](https://abrarec.com.br/blog/); feed `/feed/` (8 itens, último 19/11) | só rodapé e [privacidade](https://abrarec.com.br/politica-de-privacidade/) (23/11/2026) | Sem termo que autorize ou proíba; robots libera | Nada autorizado; DP-28; só reescrita + link | 1 rodada/dia, até 3 matérias | **Habilitar** (DP-28) |
| FEBRABAN (`febraban`) | D | [/noticias/](https://portal.febraban.org.br/noticias/); **sem feed e sem sitemap** | sem termo localizado | Não há como listar as matérias | — | — | **Recusada para o piloto** |

**Motivo da recusa (FEBRABAN):** técnico, não jurídico. O coletor só lê feed ou sitemap com prefixo; a FEBRABAN não publica nenhum dos dois, o `robots.txt` só barra parâmetros de rastreamento e o paywall está "desconhecido". Reavaliar se ela publicar feed ou sitemap. Entrou a ABRAREC no lugar.

## Regras comuns a todas

- **Reprodução:** nunca (DP-29). A fábrica lê, reescreve com palavras próprias, cita a fonte com link e data; trecho literal só curto, entre aspas. O gate `copy_literal` barra 8 palavras iguais seguidas.
- **Imagens:** nenhuma imagem de fonte entra (D08), mesmo onde o termo permite (Senado e Câmara).
- **Ritmo:** ≥ 3 s entre requisições ao mesmo host, até 6 requisições por hora por fonte, `robots.txt` respeitado; 429, 403 ou desafio param a coleta da fonte.
- **Classe C e E:** fora do piloto.
- **Fontes classe D** não têm termo que autorize a reprodução: entram porque o proprietário aceitou o risco (DP-28). Um pedido de autorização por escrito à ABEMF e à ABRAREC (associações) reduziria o risco.

## O que o revisor humano faz antes de habilitar

1. Reabrir a página de termos (os termos mudam) e conferir que nada novo proíbe.
2. Abrir o `robots.txt` e o caminho do feed/sitemap.
3. Abrir uma matéria e confirmar que não há login nem paywall (a Livelo: o proprietário confirmou na DP-49 que não há paywall, só login na área da conta; o cadastro agora traz paywall "nenhum").
4. Registrar a revisão com a nota sugerida (cita a classe e a DP-28) e marcar "URL verificada" e "robots conferido".
5. Um `admin` ou `editor-chefe` habilita. Para desfazer: desabilitar é permitido também ao revisor.
