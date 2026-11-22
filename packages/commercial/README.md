# @loyaltynews/commercial (Frente 10)

Módulo comercial do Loyalty News 2.1, em TypeScript sem dependências de runtime. Persistência é in-memory (interfaces de domínio); o schema SQL fica em `packages/db` (Chief Architect) e a API em `apps/web/app/api` (Backend).

| Arquivo | O que faz |
|---|---|
| `src/formats.data.ts` | 47 formatos gerados de `r0-preparacao/arquitetura/formatos-comerciais-47.json` (`npm run gen:formats`) |
| `src/catalog.ts` | estado (disponivel / sob_consulta / indisponivel), preço de referência, 8 pacotes (fora dos 47) |
| `src/inventory.ts` | 9 posições, reservas com conflito de cotas, contrato mínimo, takeover, disponibilidade |
| `src/rotation.ts` | rotação ponderada, impressões servidas/visíveis, cliques válidos, bot/interno/refresh, house ad |
| `src/campaigns.ts` | máquina de estados da campanha |
| `src/crm.ts` | leads, contas, oportunidades e funil |
| `src/metrics.ts` | métrica com origem, período, horário, status e envelhecimento |
| `src/mediakit.ts` | mídia kit de 8 blocos + HTML estático |

Regras: nenhum formato nasce `disponivel` sem capacidade declarada; sem coleta a métrica é "— / não disponível"; nenhum mock/fixture de audiência. Testes: `npm test` (node:test, Node 26 com type stripping).
