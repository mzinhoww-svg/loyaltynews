# 10 — Implantação e rollback

| Etapa | O que liga | Quem aprova | Rollback |
|---|---|---|---|
| 0. Integração | merge da branch pelo PM depois do parecer do QA 3 | PM | revert do merge |
| 1. Staging, shadow | `SCRAPING_SHADOW_MODE`, `SCRAPING_ADAPTIVE_ROUTING_ENABLED` em staging | PM + DevOps | flags `false` |
| 2. Staging, fallback real para fontes `via-provedor` | `SCRAPING_PROVIDER_FALLBACK_ENABLED` | PM | flag `false`; volta ao Tavily único |
| 3. Produção, shadow | mesmas flags em produção | **proprietário** (produção) | flags `false` |
| 4. Produção, ativo | roteador substitui a cascata fixa | **proprietário** | flags `false` (sem deploy) |

Pré-requisitos de produção: contas e chaves no cofre do ambiente (não no código), ledger em banco compartilhado (hoje é arquivo local), alertas do FinOps ligados ao ledger, revisão de Security.

Rollback de dados: não há. O benchmark não escreve no banco nem publica.

Custos: enquanto houver só cota gratuita, o corte do `BudgetGuard` para o provedor ao chegar no teto; qualquer plano pago exige o proprietário (Diretiva V3 §2.2).
