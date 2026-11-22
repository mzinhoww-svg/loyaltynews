# 08 · Propostas de mudança: v2.0 → revisão proposta (não aprovada)

Auditoria independente pré-T00 · 21/11/2026. Nenhum documento de entrada foi alterado. Cada proposta só entra numa futura v2.1 se o responsável aprovar (`07_DECISIONS_REQUIRED.md`). "Risco" é o risco de adotar a mudança, não o de manter como está.

> **Atualização de 21/11/2026 (19:20 e 22:56).** O responsável decidiu sobre estas propostas. A situação de cada uma está em `11_CONCILIACAO.md`, seção 6: mantidas CP-01, 07, 09, 10, 12, 20, 21 e 22; ajustadas CP-18 e 19; substituídas CP-04, 14 e 15; rejeitadas CP-02, 08, 11, 13, 16 e 17; rejeitadas na redução e mantidas na correção CP-03, 05 e 06. O texto abaixo é o registro da proposta original.

## Arquitetura e operação

| ID | Antes (v2.0 e plano) | Depois (proposta) | Motivo | Dependências | Risco da mudança |
|---|---|---|---|---|---|
| CP-01 | Blueprint §8 e pranchas 20 e 25: Supabase para banco, identidade e arquivos. Plano: sem Supabase | Um só texto: PostgreSQL e blob na Vertra, autenticação própria com MFA; SQL padrão | F-003 | DH-18; respostas de R0-07 | Lacunas da Vertra ainda não respondidas (região, recuperação a um ponto no tempo) |
| CP-02 | OpenBot guarda identidades, workspaces, ferramentas e coordenação | Orquestração própria (fila e workers) como autoridade; OpenBot só em PoC opcional | F-040, F-041, F-042 | DH-03 | Perde-se a cabine pronta do produto; mais código próprio |
| CP-03 | 64 perfis com rota padrão por cargo; sete ids iguais ao departamento | Cerca de 16 perfis por tarefa; registro de 64 preservado como organograma e configuração; rota por tarefa; ids renomeados | F-020, F-023 | DH-04 | Dono pode ver a mudança como redução da visão; mitigado por manter o registro e as telas de organograma |
| CP-04 | Nove papéis `human_*` implícitos nos workflows | Registro de pessoas e RACI nominal; papéis humanos com identidade verificável | F-022 | DH-01 | Expõe que os papéis podem ser a mesma pessoa |
| CP-05 | 28 rituais ativos, 14 dailies em horário de pico, quórum em frase livre | Três rituais no início e 25 por critério; quórum numérico, calendário de feriados, regra de silêncio, mensal substitui semanal, horários fora do pico | F-030 a F-038 | DH-04 | Menos sinal entre áreas no começo; mitigado pelo digest diário |
| CP-06 | Redis e BullMQ; deduplicação semântica | Fila e outbox em PostgreSQL; dedupe por URL, semelhança de texto, entidade e data | F-051, F-052 | Teste de carga R2-11 | Se o volume crescer muito, migrar para Redis |
| CP-07 | Rotas com fallback que sobe de preço; sem classe de dado | Roteamento por tarefa e classe de dado; fallback lateral; escalonamento separado; Haiku 5.5 e Sonnet 5.5 entre os candidatos | F-061, F-062, F-063 | Evals; parecer sobre transferência internacional | Mais regras de roteamento para manter |
| CP-08 | Gateway completo com catálogo, reserva, ledger, canário e conselho semanal | Wrapper fino com teto atômico, log, limite por execução e kill switch; teto de piloto de US$ 25 a 50 | F-064 | DH-19 | Menos visibilidade fina de custo; aceitável no volume modelado |
| CP-09 | Perfis de redação com ferramenta de busca na rede | Coletor determinístico com lista de domínios e proteção contra SSRF; modelos só recebem o pacote de evidências | F-078 | — | Nenhum relevante |
| CP-18 | `project_state.json` com aprovação em campo editável; esquema de evidência com revisão e status escritos pelo executor | Estado derivado do Git; evidência com hashes e sem campo de revisão; aceite por tag assinada ou aprovação de PR por conta humana | F-120, F-121 | DH-06 | Exige disciplina de assinatura do dono |

## Editorial, dados e conformidade

| ID | Antes | Depois | Motivo | Dependências | Risco da mudança |
|---|---|---|---|---|---|
| CP-10 | 17 workflows, sem resposta e retificação, sem pedido do titular; errata só no texto; extração de entidades em evidência bruta; WF12 duplicando WF15 | Dois workflows novos (resposta e retificação; pedido do titular); passo de errata em WF08; WF06 só em matéria publicada; verificação de direitos em WF04; WF12 absorvido por WF15 | F-072, F-095, F-077, F-096, F-032 | Parecer jurídico | Contagem de workflows deixa de ser 17 |
| CP-11 | Pessoas, Moves, organogramas e watchlists no escopo até o lançamento e no premium | Só organizações no MVP; pessoas e Moves após base legal registrada; organogramas adiados | F-090, F-091 | DH-10; parecer | Adia o diferencial que o dono pediu (D05 do registro) |
| CP-16 | Sem definição do que o veículo diz sobre automação | Página institucional de metodologia; assinatura "Redação Loyalty News"; nenhum repórter inventado | F-073 | DH-09 | Contraria o pedido original do dono |
| CP-17 | Pedido original do dono: imagem do conteúdo original ou minimamente alterada, com crédito. O blueprint já exige licença, sem registro de aceite do dono | Regra única: licença registrada, ou matéria sem foto | F-071 | DH-05 | Menos imagens no início |
| CP-15 | The Loyal às 07:00 em todos os dias úteis, revisão até 06:50 | Duas ou três edições por semana, aprovação na véspera, edição pulada se não houver aprovação | F-035 | DH-13 | Menor frequência de contato com o assinante |

## Comercial e distribuição

| ID | Antes | Depois | Motivo | Dependências | Risco da mudança |
|---|---|---|---|---|---|
| CP-12 | 47 formatos cadastrados e publicados; T08-01 "reconciliar 47 SKUs" | Estado por formato: disponível, sob consulta, indisponível. Só os disponíveis aparecem como vendáveis | F-101 | DH-15 | Catálogo público menor |
| CP-13 | Tabela de benchmark e 40 cotas; servidor de anúncios com viewability, pacing e filtro de bots | Cotas fundadoras; rotação simples, contagem com filtro básico e relatório mensal | F-100, F-102 | DH-15; R1-06 | Métrica de entrega menos sofisticada |
| CP-14 | Postiz acionado pelo OpenBot; carrossel de 5 a 7 lâminas no LinkedIn | Publicação manual assistida por 60 a 90 dias; depois API ou agendador após PoC; carrossel como documento; menção a organização por padrão | F-080 a F-083, F-044 | DH-14; análise das plataformas | Trabalho manual diário no início |
| CP-22 | Pessoa jurídica e cobrança só em T10; nenhuma busca de marca | Pessoa jurídica, domínio e busca de marca na primeira onda | F-103, F-116 | DH-11 | Custo e burocracia antes de validar audiência |

Classificação da auditoria para CP-12. Dos 47 formatos, 22 dependem de operação que o MVP não tem:

| Família | Dependem de operação fora do MVP | Motivo |
|---|---|---|
| Banners (8) | Patrocínio Loyalty Market Data | Market Data é fase posterior |
| The Loyal (6) | Patrocínio do boletim de indicadores | Idem |
| Conteúdo patrocinado (6) | Matéria com retargeting; estudo ou e-book | Pixels com consentimento; capacidade de pesquisa |
| Redes e canais (4) | Envio por WhatsApp | Canal não previsto no plano |
| Entrevistas (4) | Entrevista em vídeo | Produção de vídeo |
| Loyalty Talks (4) | Os quatro | Podcast é pós-lançamento |
| Eventos (7) | Cotas master, ouro e prata; webinar ou live; café ou mesa-redonda | Eventos próprios |
| Cobertura de eventos (4) | Os quatro | Exigem pessoas no local |
| Impulsionamento (4) | LinkedIn, Instagram, retargeting | Gestão de mídia paga e pixels |

Os outros 25 podem ser oferecidos quando as telas e os processos correspondentes existirem.

## Plano, orçamento e documentação

| ID | Antes | Depois | Motivo | Dependências | Risco da mudança |
|---|---|---|---|---|---|
| CP-19 | 12 tranches, 58 tarefas, 12 semanas; tranches começam antes do fim das dependências | 7 ondas com 70 fatias de até três dias úteis e 10 itens pós-lançamento; datas relativas; calendário só após a capacidade declarada | F-110 a F-113 | DH-01, DH-02 | Prazo aparente mais longo |
| CP-21 | Orçamento só de tokens, com teto de US$ 300 sem relação com os cenários | Modelo reproduzível com API, infraestrutura, serviços a cotar e tempo humano | F-031, F-064, F-065 | DH-08, DH-19 | Nenhum relevante |
| CP-20 | Manifesto com entrada ausente; "baseline" com dois sentidos; status "homologável"; pranchas v2.0 sem mobile e com rotas faltando | Manifesto corrigido; campos `baseline_v1` e `spec_v2`; status "proposta em auditoria"; wireframes do MVP em desktop e mobile | F-001, F-002, F-004, F-006 | — | Nenhum relevante |

## O que a auditoria recomenda manter como está

- A separação entre requisito do dono, proposta e ponto em aberto do registro de decisões.
- `production_enabled: false`, bloqueio de custo desconhecido e validade de sete dias para a tabela de preços.
- Aprovação humana de toda publicação no MVP e chave por canal.
- Proibição de inventar repórter, fala, entrevista, cargo ou métrica; "não disponível" no lugar de zero.
- Outbox transacional, chaves de idempotência e publicação só com recibo.
- Contratos como especificação lógica, não como formato de importação de um produto.
- Duas redações piloto antes das dez, sem remover nenhuma editoria.
- Sinalização por campo (`allow_fetch`, `allow_ai_processing`, `allow_media`) no banco de fontes.
