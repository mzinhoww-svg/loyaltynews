# R0-01 - Registro do teto de US$ 50/mes (DP-33)
Preparado por: Security & Governance, 2026-11-23; rev. 8 em 2026-11-24. A decisao esta registrada em governance/decisions.yaml
(entrada DP-33, por ato raiz de 2026-11-23), junto com DP-44, DP-45, DP-46 e DP-47. Fonte original: r0-preparacao/decisoes-proprietario-2026-11-22.md
(registro do PM), sha256 do arquivo no momento da copia: a537de6db10efb8b0599bb7f52a27d6a781c9cb736c06d86b4bf8382221ae24d.
O trecho abaixo e copia do registro (acentos trocados por '?' para manter o arquivo em ASCII).

```
## DP-33 (23/11/2026) ? R0-01 aprovada pelo propriet?rio
Resposta ? decis?o R0-01: "aprovado, n?o precisa ter essa trava agora, est? tudo rodando com cr?ditos ou no modelo gr?tis, ent?o n?o tem problema. N?o precisa revisitar isso, apenas se acabar os cr?ditos."
- O registro do teto de US$ 50 no painel de cada provedor foi dispensado pelo propriet?rio: s? cota gratuita e cr?dito pr?-pago, sem cobran?a recorrente. O teto continua valendo nos controles internos (BalanceGuard, ledger, FinOps).
- Revisitar s? quando os cr?ditos acabarem.
- Bright Data conta 2 conectada com as zonas web_unlocker1 e scraping_browser1; a conta 1 est? em configura??o.
```

## Situacao lida nos provedores (2026-11-23, consultas gratuitas, sem valores de chave)
| Provedor | Teto registrado no provedor? | Leitura |
|---|---|---|
| OpenRouter (C8) | sim, na chave | limit = 50 USD (cumulativo, sem reset mensal); saldo da conta 4,23 USD |
| Apify (C15) | sim, mensal | maxMonthlyUsageUsd = 5; uso do ciclo 0,008 USD |
| Scrapfly (C19) | plano gratuito sem uso extra | plan_price 0; extra_scrape_allowed False; budget_limit nao definido |
| Tavily (C20, C21) | plano gratuito | Researcher, 1500 e 1000 creditos/mes; paygo_usage 0; paygo_limit nao definido |
| DeepSeek (C9) | nao (sem limite por chave) | saldo pre-pago -0,01 USD, conta indisponivel (13:08Z); RA-15 / DP-25 |
| Bright Data (C16, C17) | nao verificado | as chaves nao tem permissao de cobranca (403); saldo e limite nao lidos; escopo: risco aceito DP-46 |
| Exa (C18), Zyte (C22) | nao verificado | sem endpoint de conta gratuito conhecido; nao consultado para nao gastar credito |
| Vertra (C10, C11) | n/a | plano fixo pro-8, custo do proprietario fora do teto (DP-22); escopo de C11: risco aceito DP-46 |
| Assinaturas OpenBot (C14) | n/a | fora do teto (DP-04) |

## Leitura do criterio e decisoes que se aplicam
O criterio de aceite da R0-01 pede 'teto de US$ 50 por mes registrado em cada provedor'. Literalmente, ele so esta demonstrado
para OpenRouter (limite de 50 na chave, cumulativo) e Apify (limite mensal de 5). Para os demais provedores NAO ha teto registrado
no painel: vale a dispensa do proprietario (DP-33, governance/decisions.yaml), com o teto imposto pelos controles internos
(gateway/BalanceGuard, ledger, FinOps; degraus 35/40/42/50).
- DP-33: registro do teto no painel de cada provedor dispensado; revisitar quando os creditos acabarem.
- DP-44, DP-46 e DP-47: escopo sem restricao demonstrada aceito como risco (C15, C19, C20, C21, C22; C11, C16, C17; C13); o teto segue a DP-33.
- DP-45: se o revisor externo recusar so por estes pontos, ja decididos pelo proprietario, o aceite pode sair por override assinado pela
  raiz, citando a DP e o parecer contrario. Testes, protegidos e regras do GitHub continuam obrigatorios.
A situacao dos provedores acima foi lida em 2026-11-23 e nao mudou de decisao desde entao (nenhuma leitura nova foi feita para a rev. 8).
