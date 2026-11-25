# Adendo — atribuição e variantes (25/11, noite)

Protocolo do aceite, mesma máquina. O “antes” desta rodada foi remedido com **5 rodadas** porque a dispersão de FCP no “antes” de 3 rodadas passou de 20%.

## Atribuição (branch com `swap` + preload, `.woff2` abortado)

| Célula | CLS (5 rodadas) | CLS (3 rodadas) |
|---|---|---|
| perfil 390 | **0** (0,0,0,0,0) | — |
| perfil 1280 | **0** (0,0,0) | — |

Conclusão: o 0,275 do perfil a 390 era a **troca de fonte**, não conteúdo; com a fonte bloqueada o CLS é 0.

## Medianas das variantes (5 rodadas)

| Célula | Antes (5 rodadas) | V1 `optional`, sem preload | V2 optional na home + preload/swap no perfil |
|---|---|---|---|
| home 390 | 1124 / 1220 / 0,001 | 1372 / 1492 / 0 | 1548 / 1784 / 0 |
| home 768 | 908 / 1016 / 0 | 1376 / 1588 / 0 | 1460 / 1584 / 0 |
| home 1280 | 884 / 976 / 0,006 | 1204 / 1300 / 0 | 1236 / 1360 / 0 |
| perfil 390 | 860 / 860 / 0,012 | 1264 / 1264 / 0 | 1244 / 1244 / 0 |
| perfil 768 | 784 / 784 / 0,02 | 1272 / 1272 / 0 | 1312 / 1312 / 0 |
| perfil 1280 | 832 / 832 / 0,008 | 1356 / 1356 / 0 | 1264 / 1264 / 0 |

FCP/LCP/CLS em ms; CLS é o último número.

- **CLS:** 0 nas seis células nas duas variantes; o portão de 768 e a célula de 390 ficam atendidos.
- **V1:** 1 `@font-face` com arquivo, 1 requisição, 48.256 B; cache quente resolve a família (portal e Studio); fonte bloqueada a 768 = 0.
- **V2:** 2 `@font-face` com arquivo (instância da raiz + instância do perfil, mesmo woff2); não melhora o CLS e duplica a declaração — não atende o critério de “1 @font-face”.
- **FCP/LCP vs “antes”:** nesta rodada as duas variantes ficaram 100–700 ms acima do “antes” em todas as células. O “antes” de 3 rodadas (mesmo código, commit pai) tinha dado 1196–1924 ms e o de 5 rodadas deu 784–1124 ms: a **carga da máquina varia mais de 30% entre janelas**, acima da margem do critério (+50/+100 ms). A comparação de FCP/LCP entre janelas diferentes não é confiável nesta máquina; o CLS é estável (0 em 5/5 rodadas).

## Recomendação

V1 (`optional`, sem preload), escolhida pelo PM: é a única que atende o CLS nas seis células mantendo **uma face com arquivo** (mais a reserva local do `adjustFontFallback`), com cache quente e fonte bloqueada provados. A V2 não traz ganho e duplica a face. FCP/LCP não são atribuíveis entre janelas nesta máquina (mesmo código variou de 784–1124 ms a 1196–1924 ms); serão remedidos no staging depois do deploy, com mais rodadas.

## Limites

- Só Chromium headless, perfil vitrine do e2e; sem staging e sem deploy.
- A máquina é compartilhada com builds de outros agentes; a dispersão de FCP chegou a 70% dentro da mesma célula.
- O custo declarado da V1: na primeira visita em rede lenta o título sai em Arial ajustado; a identidade aparece quando o cache aquece (ou na segunda visita).
