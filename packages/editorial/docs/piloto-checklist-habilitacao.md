# Checklist de habilitação das fontes do piloto (1 página) — para o proprietário

**Onde:** Studio → Fontes da Fábrica (`/studio/fontes/fabrica`). **Quem:** você (admin ou editor-chefe, com MFA): uma pessoa pode revisar e habilitar (só não pode ser a pesquisadora das fontes). **Base:** DP-28 (risco aceito). Detalhes e termos lidos: `docs/piloto-fontes.md`. Habilitar não coleta nada sozinho: a coleta só roda quando o job editorial for ligado (flags `editorialCollector`/`editorialPipeline`, a cargo do DevOps/PM).

## Para CADA fonte (2 passos: revisar, depois habilitar)

1. Abrir o link dos termos e do `robots.txt` (colunas abaixo) e ver que nada novo proíbe. 2. Abrir 1 matéria da listagem: sem login nem paywall.
3. **Revisar:** Termos = **Aprovado**; marcar **URL verificada** e **robots conferido**; Paywall = **nenhum**; colar a nota. 4. **Habilitar** (botão separado).

| ✔ | Fonte (id) | Classe | Termos / listagem para abrir | Nota (colar; até 2000 caracteres) | Atenção |
|---|---|---|---|---|---|
| ☐ | Agência Senado (`senado-noticias`) | A | [política de uso](https://www12.senado.leg.br/noticias/politica-de-uso) · [listagem](https://www12.senado.leg.br/noticias) | "Termos da Agência Senado (política de uso) lidos em 23/11/2026: reprodução livre sem descaracterizar, com citação da Agência Senado e do autor; robots.txt conferido (sem regras para o agente); sem login/paywall; classe A; DP-28." | — |
| ☐ | Câmara Notícias (`camara-noticias`) | A | [termo de uso](https://www2.camara.leg.br/termo-de-uso-e-politica-de-privacidade) · [listagem](https://www.camara.leg.br/noticias/) | "Termo de uso do Portal da Câmara lido em 23/11/2026 (itens 7 e 29: trechos entre aspas, informações de domínio público, citar a Câmara e a autoria); robots.txt conferido (feed e /noticias permitidos); sem login/paywall; classe A; DP-28." | Responde 429 em rajada: no máximo 1 rodada por dia |
| ☐ | ABEMF (`abemf`) | D | [rodapé/associados](https://web.abemf.com.br/associados/) · [listagem](https://web.abemf.com.br/noticias/) | "DP-28, classe D, risco aceito pelo proprietário; site sem termos de conteúdo (só rodapé de direitos reservados, lido em 23/11/2026); robots.txt conferido (/noticias/ e /feed/ permitidos); sem login/paywall." | Feed parado desde 22/10: pode não render matéria nova |
| ☐ | Livelo imprensa (`livelo-imprensa`) | D | [privacidade](https://www.livelo.com.br/politica-de-privacidade) · [regulamentos](https://www.livelo.com.br/regulamentos) · [imprensa](https://www.livelo.com.br/imprensa) | "DP-28, classe D, risco aceito pelo proprietário; rodapé só com Regulamentos e Privacidade (lidos em 23/11/2026); robots.txt permite /imprensa; coleta por sitemap /imprensa/; sem login/paywall (conferido)." | **Conferir o paywall** (está "desconhecido"); releases de agosto |
| ☐ | ABRAREC (`abrarec`) | D | [privacidade](https://abrarec.com.br/politica-de-privacidade/) · [blog](https://abrarec.com.br/blog/) | "DP-28, classe D, risco aceito pelo proprietário; sem termos de conteúdo (rodapé de direitos reservados e política de privacidade, lidos em 23/11/2026); robots.txt conferido (/blog/ e /feed/ permitidos); sem login/paywall." | — |

**Fora do piloto (não habilitar):** FEBRABAN (sem feed nem sitemap: o coletor não consegue ler), qualquer fonte de classe C ou E, os blogs e as fontes "via provedor" (não fazem parte desta rodada).

## Depois de habilitar

- Conferir na lista que as 5 aparecem **habilitadas** e as demais continuam desabilitadas. Para desfazer, **Desabilitar** (vale na hora).
- Se uma fonte sumir da lista de elegíveis, a revisão venceu (a definição da fonte mudou): revisar de novo.
- Reduzir o risco (opcional): pedir autorização por escrito à ABEMF e à ABRAREC; a DP-28 já cobre o risco, mas nenhum termo dessas fontes autoriza a reprodução (a fábrica só reescreve, cita e linka; nenhuma imagem).
