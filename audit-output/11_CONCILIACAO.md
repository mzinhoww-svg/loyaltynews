# 11 · Conciliação com as decisões do responsável

Registro de 21/11/2026 (horário de Brasília), em três momentos: as decisões das 19:20, as decisões das 22:56 e, às 22:57, o pedido da resposta oficial para liberar o MCP e abrir os projetos (`12_RESPOSTA_OFICIAL.md`). Este arquivo aplica as decisões do responsável ao resultado da auditoria. Onde ele divergir dos arquivos 00 a 10, vale este. Os documentos de entrada continuam sem alteração.

## 1. Decisões recebidas

| # | Hora | Decisão do responsável | Efeito |
|---|---|---|---|
| 1 | 19:20 | Nenhuma aprovação humana. Os bots aprovam e operam de forma totalmente autônoma | Os nove passos `human_*` dos workflows viram gates automáticos; não há papel humano na rotina |
| 2 | 19:20 | O aceite é por tag e autônomo | O aceite de cada gate é uma tag assinada, emitida por um verificador automático |
| 3 | 19:20 | O OpenBot é usado como runtime | Volta ao caminho crítico. F-040 está encerrado por declaração do responsável |
| 4 | 19:20 | Sem simplificações: tamanho completo desde o início | 64 perfis, 28 rituais, gateway e FinOps completos, Redis e BullMQ, servidor de anúncios completo, Intelligence completo |
| 5 | 19:20 | Adiar só a The Loyal (pronta, sem rodar) e o Instagram; LinkedIn pronto por meio do mLabs | Tudo o mais entra no lançamento |
| 6 | 19:20 | Autonomia de publicação desde o início | Sai a regra de aprovação humana no MVP e a espera de 30 dias |
| 7 | 19:20 | Há parecer favorável sobre a base legal do achado F-090 | F-090 fechado por declaração; pessoas, Moves, organogramas e watchlists entram no escopo |
| 8 | 22:56 | Imagens: a da fonte, como veio, com edição mínima | Sai a regra de licença registrada; a auditoria registra o risco (F-071) |
| 9 | 22:56 | Transparência: só a assinatura, sem nenhuma menção ao uso de IA | Assinatura "Redação Loyalty News"; sem selo e sem página de metodologia (F-073) |
| 10 | 22:56 | Fontes: uso de informação pública; não há violação em usar o que já é público | Sai o registro de permissão por fonte (F-070) |
| 11 | 22:56 | Teto de API de US$ 50; o responsável recarrega se for necessário | Substitui o padrão de US$ 300 (F-132) |
| 12 | 22:56 | Mídia kit: como está | Tabela de referência e tempo real sempre exibido (F-100, F-085) |
| 13 | 22:56 | Editorias: como estão | As dez do blueprint (F-005) |

## 2. Como as decisões entram no desenho

**Autônomo não é o mesmo que autoaprovado.** A decisão 1 tira o humano do aceite; ela não exige que o executor aprove o próprio trabalho. O achado F-120 continua válido nessa parte e passa a ser resolvido assim:

- Três identidades de bot, com credenciais separadas: executor, revisor e verificador.
- O verificador roda fora da sessão do executor, em pipeline do repositório, com uma chave de assinatura que o executor não alcança.
- O aceite sai sozinho quando cinco condições automáticas valem: os testes exigidos passam em ambiente limpo; os hashes das evidências conferem; o revisor, de outro provedor de modelo, aprova o mesmo commit; não há P0 aberto no escopo; nenhum arquivo protegido foi alterado. Aí o verificador assina a tag `gate/<gate>/accepted`.
- Uma tag de aceite criada pelo executor é inválida por construção.
- A definição do verificador (pipeline, código das conferências, lista de arquivos protegidos) fica onde o executor não escreve e só muda com a chave raiz. Sem isso, o executor aprovaria o próprio trabalho por via indireta. Detalhe em `06_MCP_SPEC.md`, seções 3 e 5.

**Publicação autônoma com freios que não pedem ninguém.** Os freios passam a ser automáticos:

- Classes de risco. Conteúdo de risco alto (acusação, tema jurídico, número controverso, movimentação de executivo sem fonte primária) fica bloqueado, não em fila de espera: na dúvida, não publica.
- Checagem por modelo de outro provedor e checagem determinística de números, datas e citações contra a evidência.
- Auditoria automática depois da publicação, com despublicação e errata quando encontra erro.
- Publicação só pela identidade de publicação, que roda depois dos gates. Nenhum agente de redação, edição ou criação recebe credencial de rede social ou de envio.

**Tamanho completo.** Os 64 perfis sobem ao runtime, com a correção que a auditoria mantém: cada um com ferramentas, esquema de saída e KPI próprios, e ids sem colisão. Os 28 rituais ficam ativos, com quórum numérico, calendário de feriados e a regra de silêncio que o blueprint já prevê.

**OpenBot como runtime.** Vale a arquitetura do próprio blueprint: o OpenBot guarda identidades, workspaces e coordenação; estado, filas, outbox e orçamento ficam no banco do projeto. Um adaptador liga os dois. Os oito testes da PoC viram testes de prontidão, e workers próprios assumem a fila se o runtime ficar indisponível, sem ação do responsável.

**LinkedIn pelo mLabs.** Resolve a exigência de aprovação direta na API do LinkedIn (F-080). As páginas do fornecedor (S33, S34) dizem que o MCP do mLabs atende página de empresa, agenda posts e aceita documento em PDF, que é o formato do carrossel. Elas não dizem três coisas de que o projeto precisa: menção a empresas e pessoas, edição e exclusão, e uso por um serviço sem interface de chat. Os três testes estão em R1-05 e R5-02. O conector do mLabs disponível nesta sessão não foi chamado: acesso privado depende de autorização separada.

**Imagens da fonte, com edição mínima.** Volta a valer o pedido original do responsável. A auditoria registra uma vez o que conferiu na lei (S24): a fotografia é obra protegida, a reprodução depende de autorização do autor e o crédito não a substitui; alterar a foto não reduz o risco, porque a lei também protege a integridade da fotografia. O risco de notificação e de cobrança é do responsável, que o aceitou. A auditoria não é parecer jurídico. Entram quatro regras automáticas:

- crédito ao autor e à fonte, com link, em toda imagem;
- edição só de enquadramento, tamanho e compressão;
- marca d'água, assinatura e crédito embutido não são removidos;
- retirada automática quando chega uma notificação, com registro.

**Assinatura institucional, sem menção a IA.** Todo conteúdo sai assinado como "Redação Loyalty News". Nenhuma página, assinatura, metadado, post ou e-mail descreve o processo de produção. A auditoria mantém dois limites, que a decisão não contraria: nenhum autor humano inventado e nenhuma afirmação de que o conteúdo foi escrito por pessoas. Pergunta direta de leitor, anunciante ou autoridade sobre o tema não é respondida por agente: vai para o responsável. A rotulagem fica pronta e desligada, para o caso de a lei passar a exigir; o PL 2338/2023 seguia em tramitação na data da consulta (S28).

**Fontes públicas.** O coletor lê só páginas de acesso público e não contorna login nem paywall. Sai o registro de permissão por fonte; fica o cadastro de cada fonte, para rastrear a origem. A auditoria registra o que conferiu na lei (S24): ideias não são protegidas e o texto de outro veículo é; a lei admite a reprodução de notícia na imprensa com menção de autor e publicação, e a paráfrase que não seja reprodução. Por isso a peça é reescrita no tom do veículo, com crédito e link, e um gate automático bloqueia cópia literal.

**Teto de API.** Contra o teto de US$ 50 por mês: com o contexto dos agentes lido de cache, cabem os cenários enxuto e base (US$ 15–37) e o alto não cabe (US$ 69–86). Sem cache, nenhum cenário cabe inteiro, e só o enxuto chega perto (US$ 47–66). O teto é rígido: quando é atingido, a operação para sozinha, avisa o responsável e volta depois da recarga. Cache de prompt passa a ser requisito do gateway. US$ 50 é o topo da faixa de piloto que a auditoria tinha recomendado em DH-19, pensada para o escopo enxuto; com o escopo completo, a folga é menor. A auditoria propõe uma ordem do que para primeiro quando o saldo aperta (`04_FINOPS_MODELOPS.md`, seção 9), que vira ADR em R0-08.

## 3. O que continua sendo do responsável

Não é aprovação de rotina. São atos que terceiros ou a lei só aceitam de uma pessoa, física ou jurídica (F-131), mais a recarga do saldo, que o responsável escolheu fazer:

| Ato | Quando |
|---|---|
| Abrir as contas e gerar as chaves com escopo mínimo: hospedagem, repositório, provedores de modelo, e-mail, analytics | R0-01, a primeira tarefa |
| Registrar o teto de US$ 50 por mês em cada provedor | R0-01 |
| Guardar a chave raiz e a parada de emergência | R0-01 |
| Registrar o domínio | R0-09 |
| Informar a pessoa jurídica e o responsável legal | R1-01 |
| Conectar a página do LinkedIn ao mLabs | R1-05 |
| Dar acesso à máquina do OpenBot | R2-09 |
| Meio de pagamento para os planos pagos | Antes de R5-14 |
| Recarregar o saldo de API quando o teto for atingido | Quando ocorrer; o sistema avisa antes |
| Assinar contratos e responder a notificação legal ou pedido de resposta | Quando ocorrerem; o sistema faz triagem, toma a ação automática cabível e avisa |
| Usar a chave raiz para trocar uma identidade ou mudar o que o verificador confere | Exceção; não faz parte da rotina |

A parada de emergência existe para que o responsável possa interromper tudo sem depender de nenhum agente. Ela não é um passo de aprovação.

## 4. Pontos que estavam com padrão assumido

Às 19:20 a auditoria assumiu, para os pontos sem decisão, o que estava escrito no dossiê. Às 22:56 o responsável decidiu todos eles. Não resta padrão assumido pela auditoria.

| Tema | Situação | O que vale | Achado |
|---|---|---|---|
| Imagens | Decidido às 22:56 | Imagem da fonte, com crédito e edição mínima | F-071 |
| Transparência sobre automação | Decidido às 22:56 | Assinatura institucional; nenhuma menção a IA | F-073 |
| Fontes | Decidido às 22:56 | Fontes públicas, sem permissão por fonte | F-070 |
| Teto de gasto de API | Decidido às 22:56 | US$ 50 por mês, com recarga pelo responsável | F-132 |
| Preços de mídia | Confirmado às 22:56 | Tabela de referência do blueprint | F-100 |
| Tempo real no mídia kit | Confirmado às 22:56 | Sempre exibido, com janela e fonte | F-085 |
| Taxonomia | Confirmado às 22:56 | As dez editorias propostas | F-005 |
| Formatos comerciais sem operação | Regra do próprio blueprint | Cadastrados, mas indisponíveis até existir a operação | F-101 |

## 5. Situação das decisões pendentes

| ID | Situação | Resultado |
|---|---|---|
| DH-01 | Decidida | Sem pessoas na rotina; bots executam e aprovam |
| DH-02 | Decidida | Escopo completo desde o início |
| DH-03 | Decidida | OpenBot é o runtime |
| DH-04 | Decidida | 64 perfis e 28 rituais ativos desde o início |
| DH-05 | Decidida | Imagem da fonte, com crédito e edição mínima |
| DH-06 | Decidida | Aceite por tag, autônomo |
| DH-07 | Decidida | Revisão por verificador autônomo, sem revisor humano |
| DH-08 | Decidida em parte | Parecer existente para a base legal do Intelligence; fontes, imagens e transparência decididas pelo responsável sem parecer |
| DH-09 | Decidida | Assinatura institucional; nenhuma menção a IA |
| DH-10 | Decidida | Intelligence completo, com pessoas |
| DH-11 | Entrada pendente | Pessoa jurídica e responsável legal; não bloqueia o T00 |
| DH-12 | Decidida | Fontes públicas, sem permissão por fonte |
| DH-13 | Decidida | The Loyal pronta e desligada |
| DH-14 | Decidida | LinkedIn pelo mLabs; Instagram adiado |
| DH-15 | Decidida | Comercial completo; tabela de referência do blueprint |
| DH-16 | Decidida | Tempo real sempre exibido no mídia kit |
| DH-17 | Decidida | Dez editorias |
| DH-18 | Decidida | Plano de implantação como está, mais a máquina do OpenBot |
| DH-19 | Decidida | Gateway e FinOps completos; teto de US$ 50 por mês |
| DH-20 | Decidida (nova) | Autonomia de publicação desde o início |

## 6. Situação das propostas de mudança

| ID | Situação | Observação |
|---|---|---|
| CP-01 | Mantida | Um só texto de pilha, sem Supabase: é o requisito D10 do registro |
| CP-02 | Rejeitada pelo responsável | OpenBot é o runtime |
| CP-03 | Rejeitada na redução; mantida na correção | Ficam os 64 perfis; entram contratos diferenciados e ids sem colisão |
| CP-04 | Substituída | Identidades de bots no lugar de RACI humano |
| CP-05 | Rejeitada na redução; mantida na correção | 28 rituais ativos; quórum, feriados e regra de silêncio em contrato |
| CP-06 | Rejeitada na fila; mantida no dedupe | Redis e BullMQ; dedupe sem pgvector, que a plataforma não oferece |
| CP-07 | Mantida | Roteamento por tarefa e classe de dado; fallback lateral |
| CP-08 | Rejeitada pelo responsável | Gateway completo; do texto da proposta, fica o teto de US$ 50 |
| CP-09 | Mantida | Coletor determinístico; modelos sem ferramenta de rede |
| CP-10 | Mantida, com ação automática | Resposta e retificação, pedido do titular, errata |
| CP-11 | Rejeitada pelo responsável | Pessoas, Moves e organogramas no escopo |
| CP-12 | Mantida | Estado por formato: regra do próprio blueprint |
| CP-13 | Rejeitada pelo responsável | Servidor de anúncios completo e tabela de referência |
| CP-14 | Substituída | LinkedIn autônomo pelo mLabs; Instagram adiado |
| CP-15 | Substituída | The Loyal pronta e desligada |
| CP-16 | Rejeitada pelo responsável | Sem página de metodologia; assinatura institucional e nenhum repórter inventado continuam |
| CP-17 | Rejeitada pelo responsável | Imagem da fonte, com crédito e edição mínima |
| CP-18 | Ajustada | Aceite autônomo por tag assinada pelo verificador |
| CP-19 | Ajustada | As ondas viram ordem de construção, sem corte de escopo |
| CP-20 | Mantida | Correções de documentação |
| CP-21 | Mantida | Orçamento reproduzível |
| CP-22 | Mantida | Pessoa jurídica e marca como entradas do responsável |

## 7. Achados alterados e achados novos

| Achado | Sev. | Situação na auditoria | Situação após a conciliação | Nota |
|---|:-:|---|---|---|
| F-005 | P2 | aberto (decisão) | decidido pelo dono | Decisão das 22:56: valem as dez editorias do blueprint. |
| F-010 | P1 | aberto (decisão) | risco aceito pelo dono | Escopo completo desde o início; só a The Loyal (pronta e desligada) e o Instagram ficam adiados. |
| F-020 | P1 | aberto (decisão) | aberto (redesenhado) | Mantêm-se os 64 perfis; a correção passa a ser diferenciar os 64 contratos (ferramentas, esquemas, KPI), não reduzi-los. |
| F-022 | P1 | aberto (decisão) | aberto (redesenhado) | Sem papéis humanos: os passos human_* viram gates automáticos, com identidade verificadora separada da executora. |
| F-030 | P1 | aberto (decisão) | risco aceito pelo dono | Os 28 rituais ficam ativos desde o início, com a regra de silêncio que o blueprint já prevê. |
| F-035 | P1 | aberto (decisão) | superado | A The Loyal fica construída e desligada; quando for ligada, não haverá aprovação humana. |
| F-040 | P1 | aberto (decisão) | fechado por declaração do dono | Encerrado por declaração do responsável. |
| F-041 | P1 | aberto (decisão) | decidido pelo dono | O OpenBot roda em máquina própria do responsável, fora da Vertra. |
| F-042 | P1 | aberto (decisão) | risco aceito pelo dono | O OpenBot é o runtime. Estado, filas e orçamento continuam fora dele, como o blueprint já prevê; os oito testes viram testes de prontidão. |
| F-044 | P2 | aberto | aberto (redesenhado) | Publicação autônoma, mas só pela identidade de publicação e depois dos gates automáticos; agentes de redação, edição e criação não recebem credencial de rede social. |
| F-052 | P2 | aberto (decisão) | decidido pelo dono | Mantêm-se Redis e BullMQ, como no plano; a persistência do Redis na Vertra segue como teste. |
| F-058 | P2 | aberto (decisão) | aberto | Decisão técnica por ADR, verificada contra critérios; não pede ação do dono. |
| F-064 | P2 | aberto (decisão) | risco aceito pelo dono | Gateway e FinOps completos desde o início; teto de US$ 50 por mês fixado pelo responsável às 22:56 (F-132). |
| F-065 | P1 | aberto (decisão) | superado | Sem revisão humana no fluxo, o tempo humano deixa de dimensionar o volume. Ver F-130. |
| F-067 | P2 | aberto | aberto (redesenhado) | Sem rótulo humano: golden set rotulado por modelo de classe superior, com concordância entre provedores. É uma medida mais fraca. |
| F-070 | P1 | aberto | risco aceito pelo dono | Decisão das 22:56: fontes públicas, sem registro de permissão por fonte. A auditoria não atesta a licitude da reescrita sistemática de textos de terceiros. Ficam três regras automáticas: só página de acesso público, sem contornar login ou paywall; texto reescrito, com bloqueio de cópia literal; crédito e link para a fonte. |
| F-071 | P1 | aberto (decisão) | risco aceito pelo dono | Decisão das 22:56: imagem da fonte, com crédito e edição mínima. A auditoria mantém o registro de que o crédito não substitui a autorização do autor e de que alterar a fotografia não reduz o risco (S24: art. 29 I e art. 79 §1º e §2º). Regras automáticas: crédito e link sempre; edição só de enquadramento, tamanho e compressão; marca d'água e crédito embutido não são removidos; retirada automática quando houver notificação. |
| F-073 | P1 | aberto (decisão) | decidido pelo dono | Decisão das 22:56: só a assinatura institucional 'Redação Loyalty News' e nenhuma menção ao uso de IA. A auditoria mantém dois limites: nenhum autor humano inventado e nenhuma afirmação de autoria humana; pergunta direta sobre o tema é encaminhada ao responsável. A rotulagem fica como chave desligada, para o caso de a lei passar a exigir (S28). |
| F-080 | P1 | aberto | decidido pelo dono | LinkedIn por meio do mLabs; a aprovação direta na API do LinkedIn deixa de ser necessária. As páginas do fornecedor (S33, S34) confirmam página de empresa, agendamento e documento em PDF; não tratam de menção, edição, exclusão nem de uso por serviço sem interface de chat (testes em R1-05 e R5-02). |
| F-083 | P2 | aberto (decisão) | superado | Postiz substituído pelo mLabs; Instagram adiado. |
| F-085 | P2 | aberto (decisão) | decidido pelo dono | Decisão das 22:56: vale o blueprint, com tempo real exibido com janela e fonte, sem limiar mínimo. |
| F-090 | P0 | aberto | fechado por declaração do dono | O responsável declara ter parecer favorável sobre a base legal. O parecer não foi examinado nesta auditoria. |
| F-091 | P1 | aberto (decisão) | risco aceito pelo dono | Organogramas e Moves entram no escopo desde o início. |
| F-100 | P1 | aberto (decisão) | decidido pelo dono | Decisão das 22:56: vale a tabela de referência do blueprint. |
| F-102 | P2 | aberto (decisão) | decidido pelo dono | Servidor de anúncios completo desde o início. |
| F-103 | P1 | aberto (decisão) | aberto (decisão) | Continua sendo entrada do dono; não bloqueia o T00. |
| F-104 | P2 | aberto (decisão) | decidido pelo dono | Planos pagos no escopo desde o início. |
| F-111 | P1 | aberto | superado | Autonomia de publicação desde o lançamento, por decisão do dono; a regra dos 30 dias deixa de valer. |
| F-112 | P1 | aberto (decisão) | aberto (redesenhado) | Executores e aprovadores são bots, cada um com identidade própria; o dono só faz a configuração inicial. |
| F-114 | P1 | aberto (decisão) | aberto (redesenhado) | Revisão independente por agente verificador com identidade, provedor e chave separados do executor. |
| F-120 | P0 | aberto | aberto (redesenhado) | Aceite autônomo por tag assinada pelo verificador; o executor não alcança a chave nem a definição do verificador, que só muda com a chave raiz. Continua P0 até estar implementado. |
| F-121 | P1 | aberto (decisão) | aberto (redesenhado) | Sem simplificação: contrato completo de ferramentas, com papel de verificador. O Git continua como armazenamento porque o aceite é por tag. |
| F-130 | P1 | (novo) | risco aceito pelo dono | [Escolha do dono] Publicação autônoma desde o início: nenhum humano revê o que sai, e a responsabilidade legal pelo conteúdo continua sendo do responsável. |
| F-131 | P1 | (novo) | aberto | [Informação faltante] Há atos que nenhum bot pratica pelo responsável: abrir contas e gerar chaves, assinar contratos, pagar, responder a notificação legal, recuperar credencial. |
| F-132 | P1 | (novo) | decidido pelo dono | [Escolha do dono] Com gasto autônomo, o único freio financeiro é o teto rígido, que o responsável fixou em US$ 50 por mês. |

Totais depois da conciliação: 79 achados (76 da auditoria e 3 novos). Dos 3 P0, F-055 e F-120 continuam abertos e fecham dentro do próprio T00; F-090 foi fechado por declaração do responsável.

## 8. Parecer depois da conciliação

**GO CONDICIONAL para o T00, nos termos acima.** As condições:

1. Configuração inicial feita pelo responsável, uma única vez: contas, chaves com escopo mínimo, teto de US$ 50 por mês, chave raiz e parada de emergência (F-131, F-132).
2. Inventário da hospedagem com chave só de leitura (F-055).
3. Verificador com identidade, chave e definição fora do alcance do executor, antes da primeira tag de aceite (F-120).
4. Antes do lançamento, não do T00: gates automáticos de publicação e auditoria com despublicação funcionando (F-130).

Às 22:57 o responsável pediu a resposta oficial para que o arquiteto do projeto libere o MCP e os projetos sejam abertos. Ela está em `12_RESPOSTA_OFICIAL.md`. A auditoria não autoriza implantação: por isso `implementation_authorized` continua `false` em `10_AUDIT_STATUS.json`. A liberação é ato do responsável.

## 9. O que as decisões custam, dito uma vez

- **Responsabilidade.** Sem revisão humana, erro publicado é erro do veículo. Os freios automáticos reduzem a frequência; não transferem a responsabilidade legal.
- **Imagens e fontes.** A auditoria não atesta a licitude de usar imagem de terceiro só com crédito, nem de reescrever de forma sistemática o texto de outros veículos. O risco é de notificação, retirada e cobrança, e fica com o responsável. O mesmo parecerista do F-090 pode avaliar os dois pontos antes do lançamento; não é condição do T00.
- **Medida de qualidade mais fraca.** Sem rótulo humano, o golden set é rotulado por modelo de classe superior com concordância entre provedores.
- **Mais construção antes da primeira publicação.** O backlog conciliado tem 88 itens e 169,5 dias úteis de esforço de agente até o lançamento, com caminho crítico de 49,5 dias; a versão em ondas tinha 131,5. Como a execução é de agentes, o prazo de calendário depende de quantos rodam em paralelo e dos bloqueios externos.
- **Custo de API e teto.** O gasto modelado sobe de US$ 9–73 para **US$ 47–227 por mês** sem cache de prompt; com cache em todo o contexto fixo, o piso é de US$ 15–86. A parcela nova é o contexto que cada agente carrega quando toda etapa e todo ritual rodam no runtime. Contra o teto de US$ 50 por mês: com o contexto dos agentes lido de cache, cabem os cenários enxuto e base (US$ 15–37) e o alto não cabe (US$ 69–86). Sem cache, nenhum cenário cabe inteiro, e só o enxuto chega perto (US$ 47–66). Conta em `04_FINOPS_MODELOPS.md`, seção 9.

## 10. Arquivos atualizados nesta conciliação

| Arquivo | O que mudou |
|---|---|
| `00_EXECUTIVE_SUMMARY.md` | O estado depois da conciliação vem primeiro; o sumário original fica abaixo, como registro |
| `02_FINDINGS.csv` | Situação dos achados alterados e 3 achados novos (F-130 a F-132); a nota da conciliação está no fim da coluna de ação |
| `04_FINOPS_MODELOPS.md` e `04_cost_model.csv` | Nota no início e seção 9 nova, com o custo de API refeito e o teto de US$ 50; o CSV ganhou as linhas `conciliacao` |
| `05_ROADMAP_REVISADO.md` | Reescrito: escopo completo, aceite autônomo, ondas como ordem de construção |
| `05_backlog_proposto.csv` | Refeito: escopo completo, aceite pelo verificador, regras das decisões das 22:56 |
| `06_MCP_SPEC.md` | Política de aceite autônomo, papel de verificador, definição do verificador protegida e 13 testes |
| `09_SOURCES.md` | Duas fontes novas sobre o mLabs (S33, S34) e a seção 8, com os pontos ainda sem verificação |
| `03`, `07`, `08` | Nota no início apontando para este arquivo |
| `10_AUDIT_STATUS.json` | Estado atual no topo e bloco `conciliacao` |
| `12_RESPOSTA_OFICIAL.md` | Novo: resposta oficial ao arquiteto do projeto |
| `tools/` | Scripts atualizados; `conciliacao_data.py`, `build_conciliacao_custos.py`, `custo_frase.py`, `numeros.py` e `montar.py` são novos, e os modelos de texto ficam em `tools/modelos/` |
