# 00 — Auditoria do estado atual da ingestão

Data: 23/11/2026. Base: `origin/main` 277ebab + `ft/intelligence` 88c407e + `ft/editorial` 7b35efa (merge local na branch `feature/loyalty-news-scraping-benchmark`). Somente leitura do código dos outros donos.

> Local dos documentos: `docs/` é pasta protegida no `trust.json` do verificador; enquanto o PM não abrir a mudança protegida, os documentos ficam em `packages/scraping-benchmark/docs/`.

## Como a coleta funciona hoje

| Peça | Onde | Estado |
|---|---|---|
| Coletor determinístico (RSS/Atom/sitemap/HTML direto, robots RFC 9309, Crawl-delay, espaçamento ≥ 3 s por host, sanitização, hash) | `packages/editorial/src/collector/collector.ts` | Implementado e testado; atrás de `editorialCollector` |
| Leitura "via-provedor" (DP-31 → DP-32): fontes marcadas são lidas por um `ReaderPort`; sem leitor, a fonte é pulada (`reader_unavailable`) | idem, `CollectorOptions.reader` | Implementado; desligado por padrão |
| Cascata de provedores `ChainedReader` (para no primeiro que lê; cota esgotada passa ao próximo) | `collector.ts` | Implementado |
| Tavily (`/extract`, `/search`), pool de chaves `LN_TAVILY_API_KEYS` | `packages/editorial/src/collector/tavily-reader.ts`, `apps/workers/src/editorial-factory.main.ts` | **Único leitor externo ligado ao worker**; só ativo se a variável existir |
| Firecrawl | só citado em comentários e docs (`collector.ts`, `reader-port.ts`, `dp31-leitura-via-servico.md`) | **Não há adaptador nem chave** |
| ReaderPort com pool de 2 contas, cota por chave, ritmo por host, guardas de login/paywall, `toPersistableFact` | `packages/intelligence/src/reader-port.ts` (Data, 88c407e) | Implementado e testado (226 testes no pacote) |
| Adaptadores Bright Data (Web Unlocker), Apify (RAG Web Browser), Scrapfly (basic/asp/asp_js), Zyte (http/browser), Exa (contents + descoberta) | `packages/intelligence/src/readers/*` | Implementados; teste real mínimo feito pelo Data (leitores-externos.md §5) |
| Filas | `apps/workers/src/queues.ts` (BullMQ/Redis) | A fábrica editorial roda como job (`editorial-factory.main.ts`), sem agendamento recorrente no código lido |
| Cadastro de fontes | `packages/editorial/src/sources/seed.ts` (fontes oficiais, com notas de acesso) e `seed-blogs.ts` (66 blogs) | Notas documentam os domínios problemáticos (abaixo) |

## Domínios com problema recorrente (documentados no cadastro)

| Domínio | Problema registrado |
|---|---|
| ir.latam.com / latamairlines.com | 403 ao UA direto; RSS funciona |
| santander.com.br/ri | 403 do CDN (depende do cliente) |
| itau.com.br | 403 até no robots.txt |
| staralliance.com | 403 no robots.txt |
| bcb.gov.br | páginas são SPA (HTML só com título); feed Atom funciona |
| camara.leg.br | robots declara bloqueio de bots de IA |
| edpb.europa.eu | feed respondeu 503 |
| ri.voegol.com.br | RSS anunciado retorna 404 |
| gov.br/anpd | lista carregada por JavaScript |

## Gargalos

1. **Um só caminho externo (Tavily)**: quando ele falha ou a cota acaba, as fontes `via-provedor` param. Não há medição de qual provedor lê melhor cada domínio.
2. **SPA e anti-bot**: BCB, ANPD e RIs de bancos e aéreas não entregam conteúdo ao leitor direto; nenhuma decisão por domínio baseada em dados.
3. **Sem contabilidade de crédito por produto/conta** fora do pool em memória de cada leitor; nenhuma visão consolidada para o FinOps (resolvido no ledger deste pacote).
4. **Firecrawl** citado como provedor, mas inexistente no código: hipótese de "caminho padrão" da Diretiva V3 §12 não se aplica a este repositório.

## O que este benchmark acrescenta (sem alterar os bots e pacotes existentes)

Pacote próprio `packages/scraping-benchmark` que importa `@ln/intelligence`: leitor direto com guarda SSRF, adaptador Tavily no contrato do ReaderPort, runner com checkpoint e corte por cota, critérios editoriais únicos, métricas e ranking, roteador adaptativo por domínio e livro de créditos por produto e conta.
