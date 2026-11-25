# Liberação de venda por formato (CAPACITY_RELEASES) e da flag `adServerVendas`

Origem: DP-43 (proprietário, 23/11/2026) e adendo 1 do checklist (opção 1). Nada aqui liga a venda sozinho: quem liga a flag no staging é o PM (`set_env LN_FLAGS_ON=adServerVendas`, só `APP_ENV=staging`).

## O que a DP-43 decidiu
1. À venda no lançamento: Topo, Laterais 1–3 e Rodapé. Os outros 42 ficam "sob consulta" ou "indisponível". (No catálogo isso são 3 formatos: `banners--banner-topo`, `banners--retangulo-sidebar` — as 3 laterais — e `banners--banner-rodape`; as 4 posições sem dimensão ficam de fora.)
2. Quem aprova cada imagem e campanha: o proprietário (papel admin; ajuste de permissão é do Studio 3).
3. Venda ligada só no staging agora. Produção só no go-live, com **nova decisão**.

## O que foi implementado
- `packages/contracts/src/flags.ts`: `FLAG_RELEASES.adServerVendas = { staging: 'DP-43', production: null }`. Com isso o resolvedor (ADR-022) aceita `LN_FLAGS_ON=adServerVendas` em `APP_ENV=staging` e **continua recusando** em produção ("sem decisão para production"). O padrão do código segue desligado (`FLAG_DEFAULTS.adServerVendas = false`).
- `packages/commercial/src/catalog.ts`: `CAPACITY_RELEASES` (formato → `{ staging, production }` com o id da decisão), `capacityDecision`, `capacityFor(env)`, `catalogFor(env)`. Um formato só vira `disponivel` no ambiente em que tem um id `DP-NN` válido; ambiente local, CI ou ausente nunca libera; `indisponivel` nunca é promovido; o motivo mostrado cita a DP.
- `resolveFormatStatus`: combina o código com o estado gravado em `ad_formats` (o banco já manda na disponibilidade). Falha fechada: `indisponivel` no banco **sempre** rebaixa (retirar da venda sem deploy); o banco **nunca promove** acima do código; um formato liberado pelo código fica `disponivel` mesmo com o `sob_consulta` que o seed gravou (o seed não distingue padrão de escolha).
- `apps/web/app/api/_lib/commercial/repo.ts`: `hydrate(db, now, env = flagEnvFrom(APP_ENV))` monta o catálogo com `catalogFor(env)` + `resolveFormatStatus`. O estado completo (mídia kit, disponibilidade, reserva confirmada, portão de ativação) lê esse catálogo.

## Como liberar ou retirar
- **Produção (go-live):** nova decisão do proprietário → id registrado em `governance/decisions.yaml` (ato raiz) → commit revisado preenchendo `production` em `FLAG_RELEASES.adServerVendas` **e** em cada formato de `CAPACITY_RELEASES`. O teste N6 (todo id de produção existe em `decisions.yaml`) vale para a flag.
- **Retirar um formato do staging agora:** gravar `indisponivel` em `ad_formats` (efeito imediato) ou tirar o id de `CAPACITY_RELEASES` (por commit).
- **Reverter a venda:** tirar `adServerVendas` de `LN_FLAGS_ON` e reiniciar: o ad server volta a servir só a casa e nada é contado.

## Limites
- Efeito prático no staging só depois de `LN_FLAGS_ON=adServerVendas` (PM). Até lá o mídia kit mostra os 3 formatos como disponíveis e o ad server segue desligado.
- Aprovação só do proprietário (item 2 da DP-43) é permissão do Studio, não deste commit.
- `packages/contracts/src/flags.ts` é contrato: pode exigir registro da DP-43 no manifesto (Architect).

## Adendo DP-54 (24/11/2026): produção
- O proprietário liberou os **47 formatos para PROPOSTA em produção**. `CAPACITY_RELEASES` agora tem os 47 ids: `production: 'DP-54'` em todos; `staging: 'DP-43'` só nos 3 originais (Topo, Laterais, Rodapé).
- Os 14 formatos que o código marcava `indisponivel` (Instagram, The Loyal, WhatsApp, Loyalty Talks) ficam `disponivel` em produção **com a ressalva** de que a entrega só começa com o canal ativo (campo `statusReason`, visível no Studio; o mídia kit público avisa no texto do catálogo).
- **Isto muda o catálogo e o mídia kit, não a venda no ad server.** Aprovar criativo, aprovar/ativar campanha e confirmar reserva seguem travados em produção por `FLAG_RELEASES.adServerVendas.production` (contrato; ainda `null`). Sem decisão registrada ali, a trava `SALE_DISABLED_IN_ENV` e o `SALE_NOT_ENABLED` continuam valendo.
- Banco: o `indisponivel` que o seed gravou com o motivo padrão do código é cópia do código e não vale como retirada. Retirar um formato em produção: gravar `indisponivel` em `ad_formats` com motivo próprio (efeito imediato, sem deploy).
