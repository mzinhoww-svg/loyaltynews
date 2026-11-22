# 07 · Decisões humanas pendentes

Auditoria independente pré-T00 · 21/11/2026. São decisões do responsável pelo projeto; a auditoria recomenda, não decide. Identificadores: DH-01 a DH-19 são as decisões pendentes desta auditoria; D01 a D19, sem hífen, são as linhas do registro de decisões do dossiê. Prazo relativo às ondas do roadmap proposto (`05_ROADMAP_REVISADO.md`). "R0" corresponde ao T00 original.

> **Atualização de 21/11/2026 (19:20 e 22:56).** O responsável decidiu. A situação de cada decisão está em `11_CONCILIACAO.md`, seção 5, e prevalece sobre as recomendações abaixo: estão decididas todas, incluída a nova DH-20 (autonomia de publicação desde o início), menos duas. DH-08 está decidida em parte: há parecer para a base legal do Intelligence, e os demais pontos jurídicos foram decididos pelo responsável sem parecer. DH-11, pessoa jurídica e responsável legal, é entrada ainda pendente e não bloqueia o T00. As tabelas abaixo ficam como registro do que a auditoria recomendou.

## Decisões que precisam sair antes de qualquer execução

| ID | Decisão | Recomendação da auditoria | Alternativas | Impacto de adiar | Prazo | Achados |
|---|---|---|---|---|---|---|
| DH-01 | Quem trabalha no projeto e quantas horas por semana; quem ocupa cada um dos nove papéis humanos dos workflows | Declarar por escrito, com nomes. Se for uma pessoa, dizer isso | Manter os papéis genéricos do plano | Nenhum cronograma é calculável; aceite e revisão ficam sem dono | Antes de R0-01 | F-112, F-022, F-114 |
| DH-02 | Tamanho do MVP | Três ondas (presença e validação; redação assistida; distribuição e receita), com o restante preservado como "indisponível". Com uma pessoa em tempo parcial, começar por R0 + R1 e um portal reduzido a duas redações | Manter tudo até o lançamento, como no plano | Meses de construção antes do primeiro leitor | Aceite de R0 | F-010, F-011 |
| DH-03 | Papel do OpenBot | Fora do caminho crítico. Orquestração própria com fila e workers. PoC opcional, só com licença comercial e critérios de abandono | OpenBot como runtime; híbrido desde já; encerrar a opção | Risco de licença e de operar produção sobre produto em versão 0.x | ADR em R0 | F-040, F-041, F-042 |
| DH-04 | Organização e rituais | Preservar o registro de 64 funções e 28 rituais; executar com cerca de 16 perfis por tarefa; ativar no início um ritual diário, um semanal e um mensal, e os demais por critério de volume | 64 perfis e 28 rituais desde o dia 1; modelo enxuto sem registro (contraria D07 e D08 do registro) | 95 a 150 chamadas e 18 atas por dia sem leitor | ADR em R0 | F-020, F-030 |
| DH-05 | Regra de imagens | Confirmar por escrito a regra do blueprint: imagem só com licença registrada; sem licença, a matéria sai sem foto. Abandonar "minimamente alterada com crédito" | Manter o pedido original | Infração potencial a cada imagem | Aceite de R0 | F-071 |
| DH-06 | Governança e aceite | Arquivos versionados + CLI + MCP local de leitura; aceite só por tag assinada ou aprovação de PR por conta humana | Servidor MCP remoto com banco; só arquivos | Gates sem integridade | Antes do aceite de R0 | F-120, F-121 |
| DH-07 | Revisão independente | Revisor em sessão separada, sem o contexto do implementador, em todos os gates; revisor externo nos gates de fundação e de lançamento | Autorrevisão; QA nominal como no plano | Aceite sem independência real | Aceite de R0 | F-114 |
| DH-08 | Orçamento para parecer jurídico e serviços a cotar | Aprovar o parecer (fontes, imagens, LGPD, transparência, direito de resposta) e cotar e-mail, backup, licenças | Seguir sem parecer | Bloqueia R4 e o produto de pessoas | R0-10 | F-070, F-090, F-065 |

## Decisões de produto e de risco

| ID | Decisão | Recomendação da auditoria | Alternativas | Impacto de adiar | Prazo | Achados |
|---|---|---|---|---|---|---|
| DH-09 | Transparência sobre automação editorial | Página institucional de metodologia dizendo como a redação trabalha, com assinatura "Redação Loyalty News" e sem repórter inventado. Sem selo em cada matéria | Nunca informar (pedido original); selo por matéria | Risco reputacional se a automação for descoberta sem ter sido informada; a página de políticas fica indefinida | Antes de R3-10 | F-073 |
| DH-10 | Entity Intelligence no MVP | Só organizações, marcadas a partir das matérias publicadas. Pessoas, Moves e watchlists depois do parecer. Organogramas adiados | Tudo como no blueprint | Maior risco jurídico do projeto | ADR em R0 | F-090, F-091 |
| DH-11 | Pessoa jurídica | Constituir ou indicar agora, com responsável legal nomeado | Operar como pessoa física até a cobrança | Sem contrato, sem emissão fiscal, sem API do LinkedIn, sem controlador identificado | Início de R1 | F-103, F-080 |
| DH-12 | Política de fontes | Começar por fontes primárias (relações com investidores, reguladores, salas de imprensa, associações). Veículos comerciais só após parecer e registro de termos por fonte | Banco de fontes completo do blueprint | Risco concentrado nos veículos com paywall | Antes de R4-01 | F-070, F-013 |
| DH-13 | The Loyal: frequência e regra de corte | Começar com duas ou três edições por semana; aprovação na véspera; sem aprovação até o corte, a edição é pulada | Diária às 07:00 desde o início | Depende de uma pessoa todo dia útil antes das 06:50 | Antes de ligar a The Loyal (P-01) | F-035 |
| DH-14 | Publicação social | LinkedIn primeiro, com publicação manual assistida por 60 a 90 dias; API ou agendador após PoC; Instagram depois | Postiz acionado pelo OpenBot; APIs desde o início | Automação presa à análise das plataformas | Antes de R5 | F-080, F-083, F-044 |
| DH-15 | Comercial | Cotas fundadoras para três a cinco marcas, com seis a oito formatos ativos; os demais "sob consulta" ou "indisponível". Preço fixado depois de cinco conversas com anunciantes | Tabela de 47 formatos a preço de benchmark | Tabela sem lastro e formatos sem operação à venda | Depois de R1-06 | F-100, F-101, F-102 |
| DH-16 | Mídia kit: quando mostrar tempo real | Só acima de um limiar definido pelo dono; abaixo dele, métricas de 30 dias com data e método | Sempre mostrar | Número baixo exposto ao anunciante | Antes de R5-11 | F-085 |
| DH-17 | Taxonomia | Validar ou corrigir as dez editorias | Seguir com a proposta | Redações, menus e rotas sobre lista não validada | Antes de R3-01 | F-005 |

## Decisões técnicas com efeito de custo ou risco

| ID | Decisão | Recomendação da auditoria | Alternativas | Impacto de adiar | Prazo | Achados |
|---|---|---|---|---|---|---|
| DH-18 | Hospedagem e dados | Vertra para web, API, workers, banco e blob; fila e outbox em PostgreSQL; sem Supabase e sem Vercel no MVP. Rever se as respostas de R0-07 mostrarem lacuna de segurança | VPS único; Supabase + Vercel | Dois documentos com pilhas diferentes no repositório | Depois de R0-07 | F-003, F-050, F-052 |
| DH-19 | Modelos e orçamento de API | Teto de piloto de US$ 25 a 50 por mês; classes de dado com provedores permitidos; incluir Haiku 5.5 e Sonnet 5.5 no eval; decidir por eval, não por tabela | Teto de US$ 300 e rotas do contrato | Dados pessoais sem regra de destino; controle desproporcional | Antes de R2-07 | F-062, F-064, F-061 |

## Decisões que tocam requisito explícito do dono

Quatro recomendações alteram ou reinterpretam um requisito marcado como "R" no registro de decisões ou feito no pedido original. Elas só valem se o dono concordar.

| Recomendação | Requisito tocado | O que muda |
|---|---|---|
| DH-04 | D08 do registro: reuniões diárias, semanais e mensais desde o início | Continuam existindo desde o início, mas com um ritual de cada tipo; os outros 25 entram por critério |
| DH-05 | Pedido original de imagem "minimamente alterada" | Substituído por licença registrada ou matéria sem foto |
| DH-09 | Pedido original de nunca dizer que é feito por IA | Passa a existir uma página de metodologia; nenhuma matéria leva selo |
| DH-10 | D05 do registro: rastreamento profissional e organogramas | Adiado até haver base legal registrada; organizações entram já |
