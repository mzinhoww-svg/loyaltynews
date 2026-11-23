# @ln/analytics — medição do portal (Frente 09, protótipo desligado)
Contagem **agregada e própria**: sem cookie, sem identificador, sem dado pessoal, sem terceiros. Desligada por padrão (flag `analytics` de `@ln/contracts`). Decisão e plano: `docs/DECISAO-analytics-portal.md`. Convenções do scaffold: TypeScript estrito, imports sem extensão, Vitest em `src/__tests__/`.

| Arquivo | O que faz |
|---|---|
| `src/event.ts` | Schema estrito do evento (4 campos), `normalizePath` (sem query/fragmento; PII → `:id`), `classifyReferrer` (só categoria), `deviceClass` (pela largura) |
| `src/aggregate.ts` | Armazenamento agregado (dia em Brasília, caminho, origem, dispositivo → contagem), limite de caminhos, retenção, relatório com k-anonimato e "indisponível" sem dados |
| `src/consent.ts` | Consentimento por finalidade, GPC/DNT, porta única `thirdPartyMeasurementAllowed` (não carrega nada externo) |
| `src/handlers.ts` | `handleCollect` (flag, política, sinais, validação), `getAnalyticsReport` (permissão, período), `applyRetention` |
| `src/metrics.ts` | `toMetricRecords`: ponte com o `MetricStore` do mídia kit |
| `src/client.ts` | Entrada `@ln/analytics/client`: monta o corpo mínimo e decide se envia (não envia nada) |

## Garantias (cada uma com teste)
Sem cookie/armazenamento/fingerprint/rede/IP/user agent no código (varredura do fonte); evento fechado, campo extra recusado sem ecoar valor; GPC/DNT = não conta; flag desligada = 404 sem efeito; sem política publicada = 503 sem efeito; sem dados = "indisponível" com total `null` (nunca zero); células com menos de 5 suprimidas; retenção de 790 dias; `MetricStore` do Comercial aceita os registros.

## Não verificado / pendente
Rota HTTP e tabela real (Backend); beacon no portal (Frontend); IP em log de proxy/CDN (DevOps); base legal e política (parecer J-15); sem visitantes únicos, sessões, funil, geografia nem tempo real (limites assumidos); sem filtro de robôs nem limite de taxa. Nada externo foi ligado.
