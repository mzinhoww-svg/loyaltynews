# 04 · ModelOps e FinOps

Auditoria independente pré-T00 · 21/11/2026 · cálculos em `04_cost_model.csv`, gerados por `tools/cost_model.py` (reexecutável; toda premissa é uma constante nomeada no topo do arquivo).

Conclusão em três linhas: os identificadores e as tarifas do contrato conferem com as páginas oficiais; o gasto de API modelado fica entre **US$ 9 e US$ 73 por mês**, muito abaixo do teto de US$ 300; o custo que decide o tamanho da operação é o **tempo humano de revisão**, que não aparece em nenhum orçamento do dossiê.

> **Atualização de 21/11/2026 (19:20 e 22:56).** O responsável decidiu sobre as recomendações (`11_CONCILIACAO.md`). As tarifas e os cálculos das seções 1, 4 e 5 continuam valendo. Mudam cinco pontos: gateway e FinOps entram completos, não como wrapper fino; onde a seção 2 escala para uma pessoa, passa a valer o bloqueio automático; o tempo humano de revisão deixa de existir como custo; o golden set é rotulado por modelos; e o teto passa a ser de US$ 50 por mês, com recarga pelo responsável. Com tudo rodando como agente no runtime, o custo de API modelado sobe de US$ 9–73 para **US$ 47–227 por mês** sem cache de prompt; com cache, o piso é de US$ 15–86. A conta e o que cabe no teto estão na seção 9.

## 1. Verificado contra o contrato

Tarifas por 1 milhão de tokens, em dólares. Fonte entre parênteses (`09_SOURCES.md`).

| Modelo no contrato | ID existe na API? | Tarifa no contrato | Tarifa oficial em 21/11/2026 | Situação |
|---|---|---|---|---|
| `deepseek-flash` | Sim (S01) | 0,30 / 1,20 pico; 0,15 / 0,60 fora de pico | Igual | Verificado |
| `deepseek-v4-pro` | Sim (S01) | 1,32 / 3,96 pico; 0,66 / 1,98 fora de pico | Igual | Verificado |
| `claude-opus-5-5` | Sim (S03) | 4 / 20 | Igual (S02) | Verificado |
| `claude-fable-5-2` | Sim (S03) | 8 / 40 | Igual (S02) | Verificado |
| `gpt-image-2.6-flare` | Sim (S04) | sem preço | US$ 30 por milhão de tokens de imagem de saída (S05, S06) | Preço por imagem **não verificado** |
| `gpt-image-2.6-sunburst` | Sim (S04) | sem preço | Idem | Preço por imagem **não verificado** |

Capacidades verificadas: `deepseek-flash` aceita visão, JSON e ferramentas; `deepseek-v4-pro` aceita JSON e ferramentas, sem visão (S01); os modelos Claude atuais aceitam imagem e uso de ferramentas (S03).

Não verificado, com teste proposto para T03: disponibilidade de cada modelo para a conta do projeto, limites de taxa, latência no percentil 95, saída estruturada nos modelos Claude, custo real por imagem. Enquanto não houver teste, o contrato deve continuar como está: `production_enabled: false` e bloqueio de custo desconhecido.

Dois fatos que o contrato não considera:

- **Janela de pico.** O DeepSeek cobra o dobro entre 06:00 e 10:00 UTC nos dias úteis (S01), que é 03:00–07:00 em Brasília. Catorze das dezoito dailies estão nessa janela (F-033).
- **Candidatos ausentes.** O Claude Haiku 5.5 custa 0,10 / 0,50 em prompts de até 100 mil tokens, e metade disso em lote (S02): abaixo do DeepSeek Flash dentro e fora do pico. O Sonnet 5.5 custa 2 / 10. Nenhum dos dois está entre os candidatos (F-061). Preço não é qualidade: entram no golden set, e o eval decide.

Tarifa de API e assinatura de chat são coisas diferentes. Um plano de chat ou de ferramenta de código não gera crédito de API, e o contrário também vale. O OpenBot, por desenho, usa as assinaturas que o usuário já paga (S07); o blueprint proíbe tratar assinatura como crédito de API. As duas coisas não combinam sem decisão explícita.

## 2. Roteamento por tipo de tarefa e classe de dado

Proposta para avaliação; os modelos são candidatos, não obrigação.

| Tipo de tarefa | Classe de dado | Classe de modelo | Fallback lateral | Escalonamento | Gate |
|---|---|---|---|---|---|
| Deduplicação, renderização, agendamento, reserva de mídia | qualquer | nenhum (código) | — | — | teste automatizado |
| Triagem de item, SEO, texto social | público | econômica | outra econômica de provedor permitido | não | amostragem |
| Redação a partir de evidências | público | econômica | idem | revisão, se o eval falhar | checagem |
| Checagem de fatos | público | revisão, de provedor diferente do redator | outra de revisão | humano | bloqueia publicação |
| Direitos de texto e imagem | interno | regra em código + revisão | — | humano | bloqueia publicação |
| Extração e resolução de entidades | pessoal | só provedor com contrato de tratamento e transferência aprovada | não cruzar provedor | humano | F-090 |
| Leads, propostas, contratos | comercial sigiloso | idem | não cruzar provedor | humano | aprovação comercial |
| Síntese de ritual diário | interno | econômica ou revisão | lateral | não | ata |
| Board mensal | interno | premium | lateral | humano | aprovação do dono |
| Ilustração conceitual | público | imagem | — | não | rótulo de ilustração |

Regras: o fallback nunca sobe de classe sozinho (hoje a rota econômica termina em Opus e a premium cai para Fable, F-063); subir de classe é escalonamento, com motivo registrado e orçamento próprio; classe de dado desconhecida é tratada como a mais restrita; nenhum modelo recebe ferramenta de rede (F-078).

## 3. Gateway: próprio completo, wrapper fino ou de terceiro

Comparação em `03_ARCHITECTURE_OPTIONS.md`, matriz M6. Recomendação para o MVP: **wrapper fino**, com o contrato de interface do blueprint preservado para evoluir depois.

O que o wrapper precisa ter desde o primeiro dia:

- **Teto atômico.** Antes de cada chamada, uma transação soma o custo máximo estimado ao contador do dia e do mês; se passar do teto, a chamada não sai. Concorrência resolvida por bloqueio de linha no PostgreSQL.
- **Reserva e reconciliação.** Reserva pelo máximo (tokens de entrada medidos + limite de saída); depois da resposta, ajuste pelo uso real informado pelo provedor; diferença registrada.
- **Log por chamada.** Identificador de execução, tarefa, perfil, modelo, versão do prompt, tokens, custo, latência, resultado da validação de esquema. Sem conteúdo sensível.
- **Kill switch.** Uma chave global e uma por rota, lidas a cada chamada.
- **Limite por execução.** Máximo de tokens de saída e de tentativas (três, como no contrato).
- **Segunda barreira.** Limite de gasto configurado no console de cada provedor, se existir; a existência desse recurso em cada provedor não foi verificada nesta auditoria.

Fica para depois, por desproporção ao gasto (F-064): catálogo com promoção por canário, estúdio de roteamento, conselho semanal de FinOps, ledger multimoeda.

## 4. Custos unitários

Tarifas verificadas; tokens por etapa são **premissa** (61 mil de entrada e 8,5 mil de saída por matéria, somadas nove etapas). Valores por tentativa, cenário base. R1 é o roteamento do contrato (DeepSeek Flash e V4 Pro, 30% dos tokens em pico); R2 é Haiku 5.5 e Sonnet 5.5; R3 é Haiku 5.5 com V4 Pro.

| Unidade | R1 | R2 | R3 |
|---|---:|---:|---:|
| Matéria completa, com retry de 1,3 | US$ 0,057 | US$ 0,127 | US$ 0,051 |
| — só checagem de fatos | 0,016 | 0,043 | 0,016 |
| — só redação | 0,004 | 0,002 | 0,002 |
| Pacote social (texto + QA visual) | 0,003 | 0,002 | 0,002 |
| Entidade enriquecida fora de matéria | 0,006 | 0,003 | 0,003 |
| Item de fonte triado | 0,0004 | 0,0002 | 0,0002 |
| Ilustração gerada | 0,05 (premissa) | idem | idem |

Reuniões, por ocorrência, no cenário base e com as rotas do registro: daily de redação US$ 0,007; daily editorial US$ 0,10 (doze participantes, modelo de revisão, em horário de pico); sincronização de diretorias US$ 0,03; interdiretorias semanal US$ 0,26 (Opus); board mensal US$ 0,52 (Fable); comitê extraordinário US$ 0,16.

## 5. Custo mensal por cenário

Cenários (premissas): enxuto 4 matérias por dia útil, 60 itens triados por dia, 3 edições por semana; base 6 matérias, 150 itens, 5 edições; alto 12 matérias, 400 itens, 5 edições. Mês de 21 dias úteis.

API, em dólares por mês:

| | Enxuto | Base | Alto |
|---|---:|---:|---:|
| Produção, R1 | 6,62 | 12,97 | 32,02 |
| Produção, R2 | 12,14 | 21,95 | 50,52 |
| Produção, R3 | 5,68 | 10,84 | 26,61 |
| 28 rituais do registro | 3,45 | 8,73 | 22,20 |
| **Total com rituais do registro** | **9,13 – 15,59** | **19,57 – 30,68** | **48,81 – 72,72** |
| Total com rituais da onda inicial | 7,12 – 13,58 | 12,28 – 23,39 | 28,05 – 51,96 |

Sensibilidades no cenário base: se cada uma das nove etapas rodar como agente com harness (15 mil tokens por turno, três turnos), somam-se US$ 27,60 (R1) a US$ 48,65 (R2) por mês; se 10% das etapas econômicas escalarem para Opus, somam-se US$ 3,77. Mesmo somando tudo, o cenário base fica abaixo de US$ 100.

Infraestrutura, em reais por mês, preço de tabela (S15): enxuto R$ 47,90; base R$ 80,80; alto R$ 187,80.

Total indicativo em reais, somando API e Vertra com câmbio **hipotético** de R$ 5,50: enxuto R$ 98–134; base R$ 188–250; alto R$ 456–588.

Fora desses totais, por falta de preço verificado: licença comercial e VPS do OpenBot (se adotado), Postiz em nuvem (a partir de US$ 29 por mês, S10), provedor de e-mail, destino externo de backup, licenças de imagem, revisão jurídica, pesquisa na web por modelo (US$ 10 por mil buscas na Anthropic, S02) e impostos.

Tempo humano do gate do MVP (premissas: 8 minutos por matéria, 2,5 por post, 15 por edição, 2 por entidade, 30% das entidades revisadas):

| | Enxuto | Base | Alto |
|---|---:|---:|---:|
| Minutos por dia útil | 59 | 94 | 172 |
| Horas por mês | 21 | 33 | 60 |

Este é o número que dimensiona o MVP. Com 30 minutos disponíveis por dia, cabem cerca de duas matérias, um post e uma edição em dias alternados.

Receita: contas de ordem de grandeza, **sem valor de previsão**. Não há audiência medida nem conversa com anunciante; os preços são os de referência do blueprint.

| Hipótese | Conta | R$ por mês |
|---|---|---:|
| Três cotas fundadoras de rodapé | 3 × 1.250 | 3.750 |
| Três cotas de sidebar e uma de topo | 3 × 1.750 + 3.000 | 8.250 |
| Cinco marcas no pacote "Presença no mercado" | 5 × 4.000 | 20.000 |
| Capacidade teórica dos espaços principais, 100% vendida | 4 × 3.000 + 30 × 1.750 + 6 × 1.250 | 72.000 |

Do outro lado da conta estão R$ 100 a 600 por mês de API e hospedagem, os serviços a cotar e o tempo humano. O que limita a receita no MVP não é o custo: é a audiência que ainda não existe e a capacidade de entregar o que for vendido (25 dos 47 formatos, F-101).

## 6. O que o orçamento do dossiê acerta e erra

Acerta: a aritmética das 27 linhas confere; a ordem de grandeza por matéria (US$ 0,08 no cenário enxuto do dossiê) é compatível com este modelo; registra que imagens, pesquisa, infraestrutura e licenças ficam de fora.

Erra ou omite: usa 56 contribuições diárias quando o registro tem 77 participações e conta semanais e mensais como uma chamada só (F-031); ignora o preço de pico justamente no horário das dailies (F-033); o teto de US$ 300 não tem relação com os cenários, que somam de US$ 11 a US$ 22 (F-064); não modela triagem de itens que não viram matéria, entidades fora de matéria, retry, nem tempo humano (F-065).

## 7. Evals, promoção e rollback de modelos

Golden set inicial enxuto, rotulado pelo editor humano: 30 pautas com evidências e resposta esperada; 15 pares de entidades com homônimos; 10 pacotes sociais; 10 casos de abuso (instrução embutida em fonte, número trocado, citação inexistente, imagem sem licença). Crescer para os tamanhos do blueprint depois do lançamento.

Um modelo é **promovido** a uma rota quando, no golden set e em avaliação cega: nenhum fato material sem evidência; nenhuma citação ou cargo inventado; JSON válido em pelo menos 99% das saídas; custo por peça aprovada igual ou menor que o do modelo atual, ou ganho de qualidade que o editor aceite por escrito; latência no percentil 95 dentro do limite da tarefa; classe de dado permitida para o provedor; aprovação humana registrada.

Promoção em dois passos: 10% das tarefas por sete dias, com comparação diária; depois 100%.

**Rollback** imediato, por troca de versão da política, se em produção ocorrer qualquer um: um fato material errado publicado; taxa de bloqueio na checagem 50% acima da linha de base por dois dias; custo por peça 30% acima do previsto por três dias; indisponibilidade acima de 5% das chamadas em uma hora.

## 8. Testes para T03

1. Listar modelos em cada provedor e conferir os seis IDs.
2. Uma chamada de fumaça por modelo, com saída estruturada e uso de ferramenta.
3. Gerar dez imagens em dois tamanhos e registrar o custo real.
4. Corrida de orçamento: cem chamadas simultâneas contra um teto que comporta dez; nenhuma a mais pode sair.
5. Custo desconhecido bloqueia; kill switch global e por rota funcionam em até um minuto.
6. Indisponibilidade simulada de cada provedor: o fallback é lateral e respeita a classe de dado.
7. Medir a mesma tarefa em pico e fora de pico e conferir a fatura.

## 9. Depois da conciliação

Registro de 21/11/2026, com as decisões do responsável das 19:20 e das 22:56 (`11_CONCILIACAO.md`). As seções 1 a 8 ficam como foram entregues; esta seção diz o que muda nelas e refaz a conta de API.

| Seção | O que valia | O que passa a valer |
|---|---|---|
| 2. Roteamento | A última escalada era uma pessoa | Bloqueio automático: na dúvida, não publica (F-130). O que pedia aprovação do dono passa pela separação entre quem propõe e quem verifica |
| 3. Gateway | Wrapper fino no MVP | Gateway e FinOps completos (tarefas R2-07 e R2-08). Os seis itens da lista continuam obrigatórios desde o primeiro dia; entram também catálogo versionado, promoção por canário, estúdio de roteamento e ledger |
| 5. Teto | US$ 300 por mês, como hipótese do baseline | **US$ 50 por mês**, fixado pelo responsável, que recarrega quando for necessário (F-132) |
| 5. Tempo humano | 59 a 172 minutos por dia útil | Nenhum na rotina. O que limita o volume passa a ser o teto de gasto e os gates automáticos |
| 7. Golden set e promoção | Rótulo do editor e aprovação humana | Rótulo por dois modelos de provedores diferentes, com concordância mínima; a promoção é aceita pelo verificador. É uma medida mais fraca (F-067) |
| 8. Testes | Previstos para T03 | São os testes de R2-07 e R2-08 |

**Custo de API depois da conciliação**, em dólares por mês. Linhas `conciliacao` de `04_cost_model.csv`; cada célula é a faixa entre os três roteamentos, e por isso as faixas não se somam linha a linha. Volumes dos cenários: enxuto, 4 matérias por dia útil; base, 6 matérias por dia útil; alto, 12 matérias por dia útil.

| | Enxuto | Base | Alto |
|---|---:|---:|---:|
| Total antes (produção e 28 rituais) | 9,13 – 15,59 | 19,57 – 30,68 | 48,81 – 72,72 |
| Sobrecarga do runtime nas nove etapas por matéria | 13,80 – 28,69 | 23,40 – 48,65 | 53,99 – 112,27 |
| Sobrecarga do runtime nas chamadas dos 28 rituais | 19,14 | 25,50 | 31,48 |
| Sobrecarga do runtime na triagem e nas entidades | 0,56 – 1,10 | 1,66 – 3,22 | 4,41 – 8,60 |
| Auditoria automática depois da publicação | 1,53 – 4,15 | 2,60 – 7,04 | 6,00 – 16,25 |
| **Total depois da conciliação, sem cache** | **46,79 – 65,52** | **77,17 – 109,08** | **154,94 – 226,87** |
| Parte do teto de US$ 50, sem cache | 94% – 131% | 154% – 218% | 310% – 454% |
| Piso: todo o contexto fixo lido de cache | 14,57 – 19,34 | 28,65 – 36,89 | 68,99 – 86,28 |
| Parte do teto, no piso | 29% – 39% | 57% – 74% | 138% – 173% |

O gasto modelado sai de US$ 9–73 e vai para **US$ 47–227 por mês** se nada do contexto do agente for lido de cache. Com todo o contexto fixo lido de cache, o piso é de US$ 15–86. O valor real fica entre os dois: os preços de leitura de cache são os das páginas oficiais (S01, S02); o preço de escrita em cache e a taxa de acerto não foram verificados. A rotulagem do golden set custa cerca de US$ 9, uma única vez.

**Contra o teto de US$ 50 por mês: com o contexto dos agentes lido de cache, cabem os cenários enxuto e base (US$ 15–37) e o alto não cabe (US$ 69–86). Sem cache, nenhum cenário cabe inteiro, e só o enxuto chega perto (US$ 47–66).**

De onde vem o aumento: com o runtime de agentes, cada etapa de matéria, cada chamada de ritual, cada lote de triagem e cada entidade carrega o contexto do agente (prompt de sistema, esquemas de ferramentas e memória). Premissas, todas em constantes no topo do bloco: 15 mil tokens por turno; três turnos por etapa de matéria e por entidade; um turno por chamada de ritual e por lote de 20 itens triados; auditoria depois da publicação do tamanho de uma checagem, feita por modelo de revisão diferente do que checou antes. A produção inclui a The Loyal como se estivesse ligada.

O que isso significa:

- **Cache de prompt passa a ser requisito do gateway.** Sem ele, nenhum cenário cabe inteiro no teto. Entra em R2-07, que mede o custo por chamada com e sem cache.
- **O teto vai ser atingido se o volume subir ou o cache falhar.** O teto é rígido e não há ninguém na rotina: quando ele bate, a operação para sozinha, avisa o responsável e volta depois da recarga. O aviso sai antes do bloqueio (R2-08).
- **Ordem do que para primeiro.** Proposta da auditoria para a ADR de R0-08: com o saldo abaixo de 20%, o sistema mantém correção, errata e auditoria do que já foi publicado, e suspende primeiro os rituais e o enriquecimento de entidades. Nada sai do escopo; só se define o que espera a recarga.
- **Horário das dailies.** Das 18 dailies, 14 caem no horário de pico do DeepSeek. Tirá-las de lá reduz a parte dos rituais sem cortar nenhum. É decisão de ADR em R0-08.
- **Medir cedo.** O contexto por turno é o maior fator de incerteza. O piloto de 50 peças (R4-14) mede o gasto real por peça antes do lançamento.
- **Hospedagem.** Não entra no teto de API. O dimensionamento do cenário enxuto, com um só plano para produção e homologação, foi pensado para a alternativa sem Redis; com o escopo completo ele é refeito no teste de carga (R2-11). A faixa de tabela vai de R$ 47,90 a R$ 187,80 por mês.

Fora dos totais: o mLabs, que a página do produto anuncia a partir de R$ 29,90 por mês por marca no plano anual, com o MCP incluso (S34; o plano do responsável não foi conferido); provedor de e-mail, destino externo de backup, pesquisa na web por modelo e impostos, sem preço verificado. A máquina do OpenBot é do responsável e não entra no modelo.
