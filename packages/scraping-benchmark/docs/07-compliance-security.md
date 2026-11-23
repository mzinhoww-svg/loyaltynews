# 07 — Conformidade e segurança

## Autorização de acesso

- **DP-32** (23/11/2026): em páginas públicas, os provedores podem usar desbloqueio próprio (CAPTCHA e proxies deles) e ignorar robots/recusa por UA. **Mantido**: nada de login ou paywall, ritmo baixo, nunca reproduzir texto, nada pago sem aprovação.
- **DP-33**: trava de cobrança dispensada enquanto tudo roda em crédito grátis ou pré-pago; mantém-se o corte ao fim da cota.

| Regra | Como o código impõe | Teste |
|---|---|---|
| Sem login/paywall | `detectLoginOrPaywall` (Data) no pool e em `quality.evaluate`; roteador para em `login_required`/`paywall`/`not_found`, sem fallback | `login/paywall param sem fallback` |
| Paywall fora do denominador | `analyze.ts` conta elegíveis = sem paywall | — |
| Ritmo baixo | runner: ≥ 15 s por host entre todos os provedores; concorrência 1 | `runner` (minSecondsPerHost) |
| Nunca reproduzir texto | JSONL só com hash, tamanho e trecho ≤ 200; texto/HTML ficam em memória | `registra cada tentativa sem texto integral` |
| Nada pago | `BudgetGuard` com teto abaixo da cota gratuita, checado antes da chamada; ledger persistido | `orçamento (corte automático)` |
| Provedor desligável | `SCRAPING_PROVIDER_<NOME>_DISABLED=true` | `provedor desligado é pulado` |
| Flags desligadas | `readFlags`: só `"true"` liga | `flags` |

## Segurança

| Risco | Medida | Teste |
|---|---|---|
| SSRF | `ssrfCheck`: só http/https, sem credencial na URL, sem host interno, sem IP privado/loopback/link-local/CGNAT/multicast/metadados; reavaliado a cada redirect; máx. 5 | `recusa IP privado…`, `redirect para rede interna é bloqueado` |
| Vazamento de segredo | segredos lidos do cofre só dentro do processo; resultado traz só o rótulo da conta; nada impresso/gravado | `segredo nunca aparece no resultado` |
| URL maliciosa/corpo enorme | teto de 3 MB no leitor direto; timeout 30 s; provedores com timeout próprio | — |
| Loop/consumo | `maxAttempts` (800) no runner; checkpoint idempotente; circuit breaker; Retry-After longo não é esperado | `circuit breaker…`, `Retry-After…` |
| Integridade do banco | o benchmark não escreve no banco nem cria migration | — |
| Publicação | nada é publicado; resultado vai só para JSONL/relatório | — |

Não verificado: termos de uso de cada portal do dataset (o risco foi aceito pelo proprietário na DP-32).
