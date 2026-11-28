# Travas da coleta contínua (28/11/2026)

Base: DP-103 (proprietário: Passageiro de Primeira e Mestre das Milhas voltam; o coletor pode baixar a página), com as condições dos pareceres
64 e 65 da Security. A entrada da DP-103 em `decisions.yaml` entra pelo 5º ato. Valem **só na coleta contínua** (`COLLECTOR_ALLOWLIST.appliesTo`);
fábrica avulsa (inclui o piloto) e pauta autoral seguem como antes.

| Condição | Onde | O que faz |
|---|---|---|
| Fontes permitidas | `collector/allowlist.ts` | `abemf`, `camara-noticias`, `procon-sp`, `passageiro-de-primeira`, `mestre-das-milhas`, por id e host. Outra fonte não gera requisição. Skift, Cathay, IATA e Bain fora. |
| Só o coletor, com nome próprio | `collector.ts` | Identificação fixa `LoyaltyNewsBot`; fonte "via provedor" recusada; sombra e provedor de leitura desligados. `robots.txt` respeitado para esse nome, relido a cada 24 h (falha: 1 h). |
| Poucas páginas | `StoreHostBudget`, `reserveRead` | Teto 6/h por host (o cadastro não aumenta), no banco, contando robots, feed, páginas e redirecionamentos. Contador fora do ar: nada sai. |
| Parar em 403/429 | idem | A rodada da fonte para e o host fica em pausa por 24 h em todas as instâncias (`collector.host_paused`). |
| Autoria | `collector/author.ts` | Só a visível na matéria; comentário, menu e rodapé não valem; na dúvida, sem autor. Bloco "Fontes:": "Agência Câmara (Câmara dos Deputados)". |
| Texto bruto com prazo | `factory/raw-text.ts` | Itens só da caixa de pautas: texto e links apagados após **7 dias** (prazo a confirmar pelo PM), a cada rodada. Fica no banco; não há escrita em arquivo, Git ou pacote. |
| Retirada | `withdrawCollected` | Apaga já texto, título e autor por fonte ou endereço. Parar a fonte: desabilitar no Studio. Ainda sem tela ou comando. |
| Sem imagem, link | já existentes | O coletor não baixa imagem; a atribuição leva o endereço. |

## O que NÃO está coberto

- **Texto próprio e confirmação no programa** são da redação: a coleta contínua não redige nem confirma. A DP-59 permite o blog como âncora principal, mas a
  regra `needs_primary_anchor` (`rules.ts`) ainda exige fonte primária; não foi alterada.
- As cinco fontes continuam desligadas no cadastro: cada uma precisa da revisão no Studio (inclui "paywall"), por uma pessoa.
- O prazo do texto não alcança matéria já redigida, itens com a coleta desligada, cópias de segurança do banco nem a fábrica avulsa.
- Pedidos da fábrica e da pauta autoral não entram no contador.
- Duas conexões reais ao PostgreSQL não foram testadas (só PGlite).
