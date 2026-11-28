# Travas da coleta contínua (28/11/2026)

Base: DP-103 (proprietário: Passageiro de Primeira e Mestre das Milhas voltam; o coletor pode baixar a página), com as condições dos pareceres
64 e 65 da Security. A entrada da DP-103 em `decisions.yaml` entra pelo 5º ato; até lá o teste de registro aparece como **pulado** (a DP-59 está inscrita na `main` `c010ceb1` e passa a valer na recomposição). Valem **só na coleta contínua** (`COLLECTOR_ALLOWLIST.appliesTo`);
fábrica avulsa (inclui o piloto) e pauta autoral seguem como antes.

| Condição | Onde | O que faz |
|---|---|---|
| Fontes permitidas | `collector/allowlist.ts` | `abemf`, `camara-noticias`, `procon-sp`, `passageiro-de-primeira`, `mestre-das-milhas`, por id e host. Outra fonte não gera requisição. Skift, Cathay, IATA e Bain fora. |
| Só o coletor, com nome próprio | `collector.ts` | Identificação fixa `LoyaltyNewsBot`; fonte "via provedor" recusada; sombra e provedor de leitura desligados. `robots.txt` respeitado para esse nome, relido a cada 24 h (falha: 1 h). |
| Poucas páginas | `StoreHostBudget`, `reserveRead` | Teto 6/h por host (o cadastro não aumenta), no banco, contando robots, feed, páginas e redirecionamentos. Contador fora do ar: nada sai. |
| Parar em 403/429 | idem | A rodada da fonte para e o host fica em pausa por 24 h em todas as instâncias (`collector.host_paused`). |
| Autoria | `collector/author.ts` | Só a visível na matéria; comentário, menu e rodapé não valem; na dúvida, sem autor. Bloco "Fontes:": "Agência Câmara (Câmara dos Deputados)". |
| Texto bruto com prazo | `factory/raw-text.ts` | Itens só da caixa de pautas: texto e links apagados após **7 dias** (confirmado pelo PM em 28/11), a cada rodada. Fica no banco; não há escrita em arquivo, Git ou pacote. |
| Retirada | `editorial-withdraw` (abaixo) | Apaga já texto, título e autor por fonte ou endereço. Parar a fonte: desabilitar no Studio. Sem tela (aceito pelo PM por ora). |
| Sem imagem, link | já existentes | O coletor não baixa imagem; a atribuição leva o endereço. |

## Parar uma fonte e atender uma retirada

| Passo | Quem | Como |
|---|---|---|
| 1. Parar a coleta | pessoa com conta de administrador no Studio | desabilitar a fonte no cadastro das fontes da Fábrica; vale antes de a próxima rodada ler aquela fonte |
| 2. Contar o que será apagado | operador de DevOps, a pedido do PM | em `apps/workers`: `npm run build:withdraw -w @ln/workers` e `node dist/editorial-withdraw.js --fonte <id>` (ou `--url <endereço>`), com `DATABASE_URL` do ambiente |
| 3. Apagar | o mesmo operador; em produção, só com autorização registrada | repetir com `--confirmar`; fica a linha `collector.raw_text_removed` na trilha |
| 4. Matéria já redigida ou publicada | redação | fluxo de correção do Studio; o comando não a alcança |

O comando nunca roda sozinho. A credencial do banco vem do cofre pelo operador e não é impressa. Ainda não foi executado contra um banco real, e o pipeline de implantação
não o inclui (não alterei `.github/`).

## O que NÃO está coberto

- **Texto próprio e confirmação no programa** são da redação: a coleta contínua não redige nem confirma.
- As cinco fontes continuam desligadas no cadastro: cada uma precisa da revisão no Studio (inclui "paywall"), por uma pessoa.
- **O prazo e a retirada não alcançam matéria já redigida nem cópias de segurança (backups) do banco.** O prazo também não roda com a coleta desligada nem alcança a fábrica avulsa.
- Pedidos da fábrica e da pauta autoral não entram no contador.
- Duas conexões reais ao PostgreSQL não foram testadas (só PGlite).
