# 00 · Sumário executivo da auditoria pré-T00

Loyalty News 2.0 · auditoria independente · 21/11/2026 · relatórios em `audit-output/` · nenhum documento de entrada foi alterado.

## Estado depois da conciliação (21/11/2026)

O responsável decidiu sobre as recomendações em duas rodadas, às 19:20 e às 22:56, e às 22:57 pediu a resposta oficial para liberar o MCP e abrir os projetos. O registro das decisões está em `11_CONCILIACAO.md`; a resposta oficial, em `12_RESPOSTA_OFICIAL.md`. Os dois prevalecem sobre o sumário original, que fica mais abaixo como registro.

**Parecer: GO CONDICIONAL para o T00, nos termos da conciliação.** A auditoria não autoriza implantação; a liberação é ato do responsável. `implementation_authorized: false`.

| Decisão do responsável | Como entra |
|---|---|
| Nenhuma aprovação humana; aceite por tag, autônomo | Um verificador automático, com identidade e chave separadas do executor, assina a tag de cada gate |
| OpenBot como runtime | Volta ao caminho crítico; estado, filas e orçamento ficam no banco do projeto |
| Sem simplificações | 64 perfis, 28 rituais, gateway e FinOps completos, Redis e BullMQ, servidor de anúncios e Intelligence completos |
| Adiar só a The Loyal e o Instagram | The Loyal construída e desligada; LinkedIn pelo mLabs |
| Autonomia de publicação desde o início | Freios automáticos: na dúvida, não publica; auditoria depois da publicação, com despublicação |
| Parecer favorável sobre a base legal de F-090 | F-090 fechado por declaração do responsável |
| Imagens da fonte, com edição mínima | Crédito e link sempre; marca d'água e crédito embutido ficam; retirada automática por notificação. Risco aceito (F-071) |
| Só a assinatura, sem menção a IA | "Redação Loyalty News"; nenhum autor humano inventado (F-073) |
| Fontes públicas, sem permissão por fonte | Só página de acesso público; texto reescrito, com crédito e link. Risco aceito (F-070) |
| Teto de API de US$ 50 por mês, com recarga pelo responsável | Teto rígido: a operação para ao atingir e volta depois da recarga (F-132) |
| Mídia kit e editorias como estão | Tabela de referência, tempo real sempre exibido, dez editorias |

A regra que a auditoria mantém: **quem executa não aceita.** O aceite é autônomo, mas vem de um verificador que o executor não consegue alterar.

| | |
|---|---|
| Achados | Depois da conciliação são 79 achados: os 76 da auditoria e 3 novos |
| P0 abertos | F-055 e F-120; fecham dentro do T00 |
| Backlog conciliado | 88 itens; 169,5 dias úteis de esforço de agente até o lançamento; caminho crítico de 49,5 |
| Gasto de API modelado | US$ 47 a 227 por mês sem cache de prompt; piso de US$ 15 a 86 com cache |
| Teto de US$ 50 | Contra o teto de US$ 50 por mês: com o contexto dos agentes lido de cache, cabem os cenários enxuto e base (US$ 15–37) e o alto não cabe (US$ 69–86). Sem cache, nenhum cenário cabe inteiro, e só o enxuto chega perto (US$ 47–66). |
| Revisão humana na rotina | Nenhuma |

Condições do T00:

1. Configuração inicial feita pelo responsável, uma única vez: contas, chaves com escopo mínimo, teto de US$ 50 por mês, chave raiz e parada de emergência (F-131, F-132).
2. Inventário da hospedagem com chave só de leitura (F-055).
3. Verificador com identidade, chave e definição fora do alcance do executor, antes da primeira tag de aceite (F-120).
4. Antes do lançamento, não do T00: gates automáticos de publicação e auditoria com despublicação funcionando (F-130).

O que as decisões custam está na seção 9 de `11_CONCILIACAO.md`.

# Registro: sumário original da auditoria (entregue às 18:00)

O texto abaixo é o sumário como foi entregue antes das decisões do responsável. As condições, as listas "Simplificar" e "Postergar" e os números de esforço ficaram superados pela conciliação.

## Parecer

**GO CONDICIONAL para um T00 restrito. NO-GO para T01 em diante.**

O projeto não está pronto para executar, mas está pronto para decidir. O T00 pode começar na forma restrita abaixo, porque é nele que as lacunas se fecham. Nada além dele deve começar antes de o responsável decidir as mudanças.

Por que não é GO: há três achados P0 abertos e falta evidência indispensável (quem executa, pessoa jurídica, parecer jurídico, respostas sobre a hospedagem).

Por que não é NO-GO: nenhum dos P0 impede um T00 somente de leitura e de decisão, desde que as condições sejam cumpridas na ordem.

Condições do T00 restrito:

1. O T00 se limita a decidir, congelar, inventariar em leitura e montar a governança mínima. Nenhum recurso é criado; nenhuma API paga é chamada.
2. Antes de qualquer tarefa: o responsável declara quem trabalha no projeto e quantas horas por semana (DH-01).
3. Antes do inventário da hospedagem: chave só com escopos de leitura e bloqueio das ferramentas de escrita no cliente (fecha F-055).
4. Antes do aceite do T00: o aceite passa a ser dado por canal autenticado separado, fora do alcance do agente (fecha F-120).
5. Nenhum dado de pessoa é coletado até haver parecer jurídico e base legal registrada (F-090 continua aberto e bloqueia o produto de pessoas, não o T00).

Este parecer não autoriza implantação. `implementation_authorized: false`.

## Os números da auditoria

| | |
|---|---|
| Arquivos do dossiê | 39; hashes conferidos; nenhum alterado |
| Achados | 76: **3 P0**, 27 P1, 42 P2, 4 P3 |
| Natureza dos achados | 45 apoiados em fato verificado; 11 propostas do projeto contestadas; 7 informações faltantes; 5 contradições; 4 premissas; 4 de outra natureza |
| Contagens declaradas | 64 funções, 17 workflows, 28 rituais, 12 tranches, 58 tarefas e 47 formatos conferem |
| Modelos e tarifas do contrato | Conferem com as páginas oficiais em 21/11/2026 |
| Gasto de API modelado | US$ 9 a 73 por mês, contra um teto de US$ 300 |
| Hospedagem (preço de tabela) | R$ 48 a 188 por mês |
| Revisão humana exigida pelo MVP | 59 a 172 minutos por dia útil, conforme o volume |
| Lançamento pelo plano original | Semana 9 declarada; semana 13 a 19 pelas próprias dependências |
| Esforço do roadmap proposto | 131,5 dias úteis até o lançamento; 30 deles são trabalho humano não delegável |

## Os três bloqueadores

| ID | O que é | Bloqueia | Como fecha |
|---|---|---|---|
| F-120 | A aprovação humana é um campo de arquivo que o próprio agente escreve | O aceite de qualquer gate, a começar pelo T00 | Aceite por tag assinada ou aprovação de PR por conta humana; estado derivado do Git |
| F-055 | O inventário "somente leitura" do T00 seria feito por um conector que também apaga e recria recursos, sem confirmação | A tarefa de inventário do T00 | Chave com escopos de leitura e bloqueio das ferramentas de escrita |
| F-090 | Perfis de pessoas, movimentações, organogramas e watchlists vendidos como produto não são tratamento exclusivamente jornalístico; a LGPD se aplica e não há base legal registrada | Qualquer coleta de dados de pessoas e o produto Intelligence de pessoas | Parecer de advogado, avaliação de legítimo interesse e relatório de impacto; até lá, só organizações |

## Dez maiores riscos

| # | Risco | Achados |
|---|---|---|
| 1 | Gates sem integridade: aceite fabricável e revisão "independente" sem ninguém atribuído | F-120, F-114 |
| 2 | Capacidade: o plano supõe uma equipe que o dossiê não mostra; o MVP exige de uma a três horas diárias de revisão humana | F-112, F-065 |
| 3 | Escopo: não há MVP; tudo entra antes do primeiro leitor | F-010, F-011 |
| 4 | Dados pessoais no Intelligence sem base legal, com operador no exterior | F-090, F-062 |
| 5 | Direitos autorais e de imagem no modelo de reescrita; pedido original de imagem "minimamente alterada" | F-070, F-071 |
| 6 | OpenBot: licença comercial obrigatória, incompatível com a Vertra como documentada, sem API pública, versão 0.75 | F-040, F-041, F-042 |
| 7 | Cronograma que contradiz as próprias dependências | F-110, F-111 |
| 8 | Organização e rituais superdimensionados: 64 perfis que são rótulos e 28 reuniões para coordenar poucas matérias por dia | F-020, F-030 |
| 9 | Comercial sem lastro: preços de um veículo com audiência, 22 de 47 formatos sem operação, sem pessoa jurídica | F-100, F-101, F-103 |
| 10 | Reputação e busca: automação não informada em nicho pequeno; conteúdo em escala sob a política de spam do Google | F-073, F-013 |

## Mudanças imprescindíveis

1. Aceite humano por canal separado e autenticado; evidência com hash; estado derivado, não declarado.
2. Capacidade declarada e MVP dimensionado pelos minutos humanos disponíveis.
3. MVP em ondas: presença e validação; redação assistida; distribuição e receita.
4. OpenBot fora do caminho crítico; orquestração própria com fila e workers.
5. Intelligence só com organizações até haver base legal para pessoas.
6. Regra de imagens e política de fontes confirmadas pelo dono, com parecer jurídico.
7. Classes de dado com provedores permitidos; fallback lateral; teto de piloto.
8. Pessoa jurídica, domínio e busca de marca antecipados.
9. Replanejamento em fatias pequenas, com datas relativas e responsáveis nominais.

## Manter, mudar, simplificar, postergar

**Manter:** a tese de um vertical B2B de fidelidade; as dez editorias, depois de validadas; aprovação humana de toda publicação no MVP; proibição de inventar repórter, fala, entrevista ou métrica; outbox, idempotência e publicação só com recibo; contratos como especificação lógica; produção desligada por padrão; a Vertra como hospedagem de web, API, workers, banco e arquivos; os registros de 64 funções e 28 rituais, como visão e configuração.

**Mudar:** o mecanismo de aceite; o runtime (próprio, não OpenBot); a pilha em um único texto, sem Supabase; rotas de modelo por tarefa e classe de dado; coleta separada dos modelos; o cronograma; o catálogo comercial, com estado por formato.

**Simplificar:** 64 perfis executáveis para cerca de 16 por tarefa; 28 rituais ativos para 3 no início; gateway completo para um wrapper fino; Redis e BullMQ para fila em PostgreSQL; servidor de anúncios para rotação simples; servidor MCP remoto para arquivos, CLI e MCP local de leitura.

**Postergar:** pessoas, Moves, organogramas e watchlists; planos pagos; The Loyal diária; Instagram; publicação social por API; autonomia de publicação; Talks, Jobs, eventos próprios e Market Data; os outros 25 rituais; a PoC do OpenBot.

## Trade-offs que o responsável precisa aceitar

- **Menos automação visível no início em troca de integridade.** Publicação social manual assistida e três rituais em vez de 28 reduzem o efeito de "empresa de agentes", mas eliminam os pontos em que um agente publica ou aprova sozinho.
- **Menos produto em troca de leitor mais cedo.** As ondas adiam o diferencial de pessoas e organogramas, que o dono pediu, para depois do parecer jurídico.
- **Mais código próprio em troca de controle.** Sem OpenBot, a orquestração é do projeto: mais trabalho, mas estado, orçamento e permissões ficam sob testes do próprio projeto.
- **Vertra em troca de incerteza a resolver.** É a opção de menor custo e é requisito do dono; região, recuperação a um ponto no tempo e rede privada ainda não têm evidência.
- **Transparência em troca de conforto.** A recomendação de uma página de metodologia contraria o pedido original de nunca informar o uso de IA.

## Decisões humanas

São 19, em `07_DECISIONS_REQUIRED.md`. As oito primeiras destravam o T00: capacidade (DH-01), tamanho do MVP (DH-02), papel do OpenBot (DH-03), organização e rituais (DH-04), regra de imagens (DH-05), governança e aceite (DH-06), revisão independente (DH-07) e orçamento do parecer jurídico (DH-08).

## Limites desta auditoria

- Nenhum ambiente real foi acessado. Tudo o que depende de conta, painel ou teste está marcado como não verificado, com teste proposto.
- Três páginas externas longas foram lidas em parte, e algumas fontes foram lidas só como trecho de busca; `09_SOURCES.md` indica quais.
- Tokens por etapa, volumes, minutos de revisão, estimativas de esforço e o câmbio são premissas da auditoria, expostas em scripts reexecutáveis.
- A variante mobile do protótipo da baseline não foi inspecionada.
- Nada aqui é parecer jurídico.

## Onde está cada coisa

| Arquivo | Conteúdo |
|---|---|
| `01_COVERAGE.md` | O que foi lido, hashes, inconsistências com referência |
| `02_FINDINGS.csv` | Os 76 achados da auditoria, com a situação depois da conciliação, e 3 achados novos |
| `03_ARCHITECTURE_OPTIONS.md` | Matrizes de decisão, arquitetura mínima, OpenBot, Vertra, organização, reuniões, MVP, ADRs |
| `04_FINOPS_MODELOPS.md` e `04_cost_model.csv` | Tarifas verificadas, roteamento, custos por unidade e por cenário; a seção 9 refaz o custo depois da conciliação |
| `05_ROADMAP_REVISADO.md` e `05_backlog_proposto.csv` | Roadmap conciliado: 88 itens, dependências, caminho crítico, mapa dos IDs anteriores |
| `06_MCP_SPEC.md` | Governança para o Claude Code, sem implementação |
| `07_DECISIONS_REQUIRED.md` | As 19 decisões |
| `08_CHANGE_PROPOSALS.md` | Delta da v2.0 para a revisão proposta |
| `09_SOURCES.md` | Fontes, datas, o que cada uma sustenta e o que ficou sem verificar |
| `10_AUDIT_STATUS.json` | Estado da auditoria em formato de máquina |
| `11_CONCILIACAO.md` | Decisões do responsável e como alteram achados, decisões, propostas e parecer |
| `12_RESPOSTA_OFICIAL.md` | Resposta oficial ao arquiteto do projeto: parecer, decisões, limites, requisitos do MCP, mudanças para a v2.1 e ordem de abertura |
| `tools/` | Anexo: scripts reexecutáveis das contagens, do modelo de custo, das matrizes e das conferências (`tools/LEIA-ME.md`) |
