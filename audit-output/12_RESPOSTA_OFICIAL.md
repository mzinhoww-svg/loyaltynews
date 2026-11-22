# 12 · Resposta oficial da auditoria

| | |
|---|---|
| **De** | Comitê independente de auditoria (Claude, na função definida pelo mandato) |
| **Para** | GPT, que conduz o projeto com o responsável e aguarda este parecer para liberar o MCP |
| **Data** | 21/11/2026, horário de Brasília |
| **Objeto** | `Loyalty_News_Dossie_Auditoria_Pre_T00.zip`, 39 arquivos, SHA-256 `938c9e13601ba435dfb873963e9ac45016009fd867e5e4a163d18b2d95ec9ddd` |
| **Mandato** | `00-instrucoes/PROMPT_AUDITORIA.md`, SHA-256 `f1ec25caaa0f62aaed0929457f8f5e87de94b6c71af596aeb307cc99e811923f` |
| **Motivo** | Pedido do responsável às 22:57: "Gere a resposta oficial para o gpt disponibilizar o mcp pra enfim abrirmos os projetos no Claude Code, github e demais lugares necessários" |

## 1. Parecer

**GO CONDICIONAL para o T00.** A auditoria está concluída e conciliada com as 13 decisões do responsável.

- Achados: 79, sendo 3 P0, 30 P1, 42 P2 e 4 P3. Dos P0, F-055 e F-120 estão abertos e fecham dentro do próprio T00; F-090 foi fechado por declaração do responsável.
- Nenhum arquivo de entrada foi alterado: os 39 hashes foram conferidos de novo no fechamento. Nada foi instalado, implementado, publicado ou contratado. Nenhum acesso privado foi usado. Nenhum prompt histórico foi executado.
- Fontes externas: 35 identificadas, todas consultadas em 21/11/2026 (`09_SOURCES.md`).

**Liberação.** A auditoria não autoriza implantação; por isso `implementation_authorized` continua `false` em `10_AUDIT_STATUS.json`, como o mandato pede. A liberação é ato do responsável, e ele pediu esta resposta para isso. Da parte da auditoria não há impedimento: o MCP pode ser liberado e os projetos podem ser abertos para o **T00**, na ordem da seção 6 e dentro dos limites da seção 3. Cada onda seguinte abre com a tag de aceite do gate anterior.

## 2. Decisões do responsável

São vinculantes para a v2.1. As sete primeiras são das 19:20; as seis últimas, das 22:56.

| # | Decisão | O que muda no projeto |
|---|---|---|
| 1 | Nenhuma aprovação humana; os bots aprovam e operam sozinhos | Os nove passos `human_*` dos workflows viram gates automáticos |
| 2 | Aceite por tag, autônomo | Tag assinada por um verificador automático, separado do executor |
| 3 | OpenBot é o runtime | Volta ao caminho crítico. F-040 está encerrado por declaração do responsável e não deve ser reaberto |
| 4 | Sem simplificações | 64 perfis, 28 rituais, gateway e FinOps completos, Redis e BullMQ, servidor de anúncios e Intelligence completos, desde o início |
| 5 | Adiados só a The Loyal e o Instagram | The Loyal construída, com a chave desligada; LinkedIn no lançamento, pelo mLabs |
| 6 | Autonomia de publicação desde o lançamento | Sai a aprovação humana do MVP e a espera de 30 dias |
| 7 | Há parecer favorável sobre a base legal do Intelligence | F-090 fechado por declaração; pessoas, Moves, organogramas e watchlists no escopo. O parecer não foi examinado pela auditoria |
| 8 | Imagens: a da fonte, como veio, com edição mínima | Sai a regra de licença registrada |
| 9 | Transparência: só a assinatura; nenhuma menção ao uso de IA | Assinatura "Redação Loyalty News"; sem selo e sem página de metodologia |
| 10 | Fontes: informação pública, sem permissão por fonte | Sai o registro de permissão por fonte; fica o cadastro das fontes |
| 11 | Teto de API de US$ 50 por mês; o responsável recarrega quando for necessário | Substitui o exemplo de US$ 300 |
| 12 | Mídia kit como está | Tabela de referência e tempo real sempre exibido |
| 13 | Editorias como estão | As dez do blueprint |

Entrada ainda pendente do responsável, que não bloqueia o T00: pessoa jurídica e responsável legal (R1-01).

## 3. Limites que a auditoria mantém

São os requisitos eliminatórios de segurança, legalidade e integridade do mandato. Nenhum contraria as decisões acima, e nenhum cria aprovação humana na rotina.

1. **Quem executa não aceita.** O aceite é autônomo, mas vem de um verificador cuja chave e cuja definição o executor não alcança (F-120).
2. **Inventário da hospedagem só com chave de leitura.** O conector da Vertra tem ferramentas de escrita e de exclusão; no T00 só se usa chave com escopo de leitura (F-055).
3. **Nenhuma publicação sem os gates automáticos.** Na dúvida, não publica; checagem por modelo de outro provedor; auditoria depois da publicação, com despublicação e errata (F-130).
4. **Publicação só pela identidade de publicação.** Agentes de redação, edição e criação não recebem credencial de rede social nem de envio (F-044).
5. **Imagens.** Crédito e link sempre; edição só de enquadramento, tamanho e compressão; marca d'água e crédito embutido não são removidos; retirada automática quando chega notificação (F-071).
6. **Assinatura.** Nenhum jornalista, fala ou entrevista inventados, e nenhuma afirmação de autoria humana. Pergunta direta sobre o processo de produção não é respondida por agente: vai para o responsável (mandato, item G; F-073).
7. **Fontes.** Só página de acesso público, sem contornar login ou paywall; texto reescrito, com crédito e link; cópia literal bloqueia (mandato, item H; F-070).
8. **Intelligence.** Só informação profissional de fonte pública, com evidência e data; sem rastreamento privado de pessoas (mandato, item I).
9. **Conteúdo pago sempre rotulado** (mandato, item G; F-074).
10. **Métricas reais.** O mídia kit mostra o que foi medido, com fonte, período e data; nenhuma audiência fabricada (mandato, item H; F-085).
11. **Resposta, retificação e pedido do titular** com registro, prazo interno e ação automática (F-072, F-095).
12. **Teto rígido.** Nenhum agente altera o teto; o aviso sai antes do bloqueio; a operação volta depois da recarga (F-132).
13. **Parada de emergência** acionável pelo responsável sem passar por agente (F-131).
14. **Nenhum segredo** em repositório, prompt, evidência ou relatório.

Riscos que o responsável aceitou, e que por isso não bloqueiam: publicação sem revisão humana (F-130); imagem de terceiro só com crédito (F-071); reescrita sistemática de textos de outros veículos (F-070); escopo completo desde o início (F-010); 28 rituais ativos (F-030); OpenBot como runtime (F-042); organogramas e Moves (F-091). Nos dois pontos de direito autoral, a auditoria não atesta a licitude. O mandato pede que ponto jurídico seja revisto por profissional habilitado (item G); a sugestão é levá-los ao mesmo parecerista do F-090 antes do lançamento.

## 4. Requisitos para liberar o MCP de governança

O texto normativo é `06_MCP_SPEC.md`. O que é eliminatório:

1. **Forma.** Arquivos versionados no repositório, uma CLI e um servidor MCP local (stdio), sem porta de rede e sem credencial dentro dele. Não é servidor remoto com banco próprio.
2. **Estado derivado do Git.** `project_state.json` deixa de ser fonte: `approved_by` e `approved_at` são campos que qualquer executor escreve.
3. **Três identidades**, com credenciais separadas: executor, revisor (em provedor de modelo diferente do executor) e verificador. `identities.yaml` só muda com a chave raiz do responsável.
4. **Ferramentas.** Dez de leitura, sem efeito colateral. Três de escrita, que só produzem proposta na árvore de trabalho: `gov_start_task`, `gov_submit_evidence`, `gov_report_block`. Duas só para o verificador, dentro do pipeline: `gov_accept_gate` e `gov_reject_gate`.
5. **Esquema fechado.** Argumento extra, como `approved: true`, devolve `NOT_ALLOWED`. Não existe ferramenta de aceite para o executor nem para o revisor.
6. **Aceite.** Tag anotada e assinada `gate/<gate>/accepted`, emitida só quando as cinco condições valem: testes exigidos passam em ambiente limpo; hashes das evidências conferem; parecer favorável do revisor sobre o mesmo commit; nenhum P0 aberto no escopo; nenhum arquivo protegido alterado fora da regra.
7. **Proteção.** Requisitos, decisões, critérios de aceite, identidades e a declaração do servidor de governança são caminhos protegidos. O pipeline do verificador, o código das conferências e a lista de caminhos protegidos ficam onde o executor não escreve e só mudam com a chave raiz.
8. **Evidência.** Hash de cada artefato, commit, autoria e chave de idempotência; sem campo de revisão ou de estado escrito pelo executor.
9. **Próxima tarefa.** `gov_next_tasks` só oferece tarefa com dependências aceitas e sem P0 aberto no escopo.
10. **Backlog carregado.** `05_backlog_proposto.csv`, com 88 itens. O mapa das 58 tarefas originais está na coluna `ids_anteriores`.
11. **Testes.** Os 13 casos da seção 9 de `06_MCP_SPEC.md` passam antes do primeiro uso; o relatório é a evidência de R0-05.

No Claude Code, o servidor entra declarado em `.mcp.json`, no escopo de projeto, versionado no repositório. Em sessão interativa o cliente pede aprovação do servidor de projeto; em execução não interativa ele carrega sem perguntar (S35). Por isso `.mcp.json` está entre os caminhos protegidos.

## 5. O que muda da v2.0 para a v2.1

| Área | Mudança obrigatória | Origem |
|---|---|---|
| Governança e aceite | Papéis `human_*` viram gates automáticos; aceite por tag do verificador; estado derivado do Git | Decisões 1 e 2; CP-04, CP-18; F-022, F-120 |
| Organização | 64 perfis mantidos, cada um com ferramentas, esquema de saída e KPI próprios; os sete ids iguais ao departamento são renomeados | CP-03; F-020, F-023 |
| Rituais | 28 ativos, com quórum numérico, calendário de feriados, regra de silêncio e alçadas automáticas | CP-05; F-030, F-036, F-038 |
| Runtime | OpenBot guarda identidades e coordenação; estado, filas, outbox e orçamento ficam no banco do projeto; adaptador por webhook assinado; workers próprios como reserva | Decisão 3; F-042 |
| Pilha | Um só texto: PostgreSQL e blob na Vertra, sem Supabase; Redis e BullMQ; deduplicação sem pgvector | CP-01, CP-06; F-003, F-051, F-052 |
| Modelos e custo | Gateway e FinOps completos; roteamento por tarefa e classe de dado; fallback lateral; cache de prompt obrigatório; teto de US$ 50 | Decisões 4 e 11; CP-07, CP-21; F-061, F-062, F-063, F-064, F-132 |
| Coleta | Coletor determinístico; modelos sem ferramenta de rede; fontes públicas | Decisão 10; CP-09; F-078, F-070 |
| Editorial | Publicação autônoma com os freios da seção 3; dois workflows novos (resposta e retificação; pedido do titular); errata propagada | Decisão 6; CP-10; F-130, F-072, F-095, F-077 |
| Imagens | Regra da decisão 8 no lugar da licença registrada | Decisão 8; F-071 |
| Transparência | Regra da decisão 9; a rotulagem fica pronta e desligada | Decisão 9; F-073 |
| Social | mLabs no lugar do Postiz; LinkedIn no lançamento; Instagram adiado; carrossel como documento | Decisão 5; CP-14; F-080, F-083 |
| Newsletter | The Loyal construída, com a chave desligada | Decisão 5; CP-15; F-035 |
| Intelligence | Completo, com pessoas, Moves, organogramas e watchlists | Decisão 7; F-090, F-091 |
| Comercial | Servidor de anúncios completo; estado por formato (disponível, sob consulta, indisponível); tabela de referência; conteúdo pago rotulado | Decisão 12; CP-12; F-100, F-101, F-102, F-074 |
| Implantação | 88 itens em sete ondas; nenhuma tarefa começa antes do aceite da dependência; pessoa jurídica, domínio e marca na primeira onda | CP-19, CP-22; F-110, F-113, F-103 |
| Documentação | Manifesto corrigido; "baseline" com um só sentido; status "proposta em auditoria"; wireframes em desktop e mobile; as 15 inconsistências listadas em `01_COVERAGE.md` | CP-20; F-001, F-002, F-004, F-006 |

A situação de cada proposta (CP-01 a CP-22) e de cada decisão pendente (DH-01 a DH-20) está em `11_CONCILIACAO.md`, seções 5 e 6.

## 6. Ordem de abertura dos projetos

Nada abaixo foi feito pela auditoria. É a onda R0 do backlog conciliado.

| Passo | Onde | O que | Quem | Tarefa |
|---|---|---|---|---|
| 1 | Contas: GitHub, Vertra, provedores de modelo, e-mail, analytics | Contas e chaves com escopo mínimo; teto de US$ 50 por mês em cada provedor de modelo; chave raiz e parada de emergência guardadas | Responsável, uma vez | R0-01 |
| 2 | GitHub | Repositório privado; branch protegida, checks obrigatórios e merge automático; três identidades de bot; definição do verificador fora do alcance do executor | Executor | R0-03 |
| 3 | GitHub | Importar o dossiê, conferir os hashes e etiquetar v1.0 e v2.0 | Executor | R0-04 |
| 4 | Claude Code | Governança: arquivos de estado, CLI e MCP local; carregar as decisões e o backlog conciliado | Executor | R0-05, R0-02 |
| 5 | GitHub, no pipeline | Verificador autônomo; o primeiro aceite só sai depois dos 13 testes | Executor constrói; o verificador aceita | R0-06 |
| 6 | Vertra | Inventário somente leitura, com chave de leitura | Executor | R0-07 |
| 7 | Repositório | ADRs, busca de marca e de domínio, registro dos pontos jurídicos, replanejamento | Executor | R0-08 a R0-11 |
| 8 | GitHub | Gate R0: tag `gate/R0/accepted`, com F-055 e F-120 fechados | Verificador | R0-12 |

Depois do gate R0: pessoa jurídica (R1-01), domínio e e-mail (R1-04), conexão da página do LinkedIn ao mLabs (R1-05). O OpenBot entra na onda R2, na máquina do responsável (R2-09). O backlog inteiro está em `05_backlog_proposto.csv`: 85 itens até o lançamento, 169,5 dias úteis de esforço de agente, caminho crítico de 49,5.

## 7. O que ainda não foi verificado e vira teste

| Ponto | Onde se testa |
|---|---|
| Vertra: região, rede privada, retenção de backup, recuperação a um ponto no tempo e persistência do Redis | R0-07 |
| Como o provedor do repositório impede que o executor altere a definição do verificador | R0-03, R0-06 |
| Como o teto de US$ 50 é imposto no console de cada provedor de modelo | R0-01 |
| mLabs: menção a empresas e pessoas, edição e exclusão, uso por serviço sem interface de chat | R1-05, R5-02 |
| OpenBot: disparo, retorno estruturado, idempotência e reinício | R2-09, R2-10 |
| Modelos: disponibilidade e limite de taxa de cada ID; custo real por imagem | R2-07, R2-08 |
| Cache de prompt: preço de escrita e taxa de acerto; contexto real por turno no runtime | R2-07, R4-14 |

## 8. Custo de API e teto

O gasto modelado é de US$ 47–227 por mês sem cache de prompt e de US$ 15–86 com todo o contexto dos agentes lido de cache. Contra o teto de US$ 50 por mês: com o contexto dos agentes lido de cache, cabem os cenários enxuto e base (US$ 15–37) e o alto não cabe (US$ 69–86). Sem cache, nenhum cenário cabe inteiro, e só o enxuto chega perto (US$ 47–66).

Três consequências para a v2.1: cache de prompt é requisito do gateway; o teto é rígido, e quando é atingido a operação para, avisa o responsável e volta depois da recarga; o FinOps define o que para primeiro quando o saldo aperta. A conta está em `04_FINOPS_MODELOPS.md`, seção 9.

## 9. O que se pede em retorno

1. A v2.1 do blueprint, dos contratos e do tracker, com as seções 2 a 5 aplicadas e uma tabela de conformidade: cada item desta resposta e o lugar onde foi atendido.
2. O MCP de governança conforme a seção 4, com o relatório dos 13 testes.
3. Os prompts de abertura do T00 reescritos para a onda R0 (R0-01 a R0-12). Os prompts históricos do dossiê não devem ser executados.
4. Divergência nova, ou requisito que não possa ser cumprido, volta registrada como achado, com evidência. Não é resolvida em silêncio.
5. Nenhum segredo nos documentos devolvidos.

## 10. Anexos

O pacote `audit-output` acompanha esta resposta. Os hashes de todos os arquivos estão em `10_AUDIT_STATUS.json`.

| Arquivo | Conteúdo |
|---|---|
| `00_EXECUTIVE_SUMMARY.md` | Estado atual e sumário original da auditoria |
| `01_COVERAGE.md` | Cobertura do dossiê, hashes e inconsistências |
| `02_FINDINGS.csv` | Os 79 achados, com situação |
| `03_ARCHITECTURE_OPTIONS.md` | Matrizes de decisão, testes do OpenBot, perguntas à Vertra, ADRs |
| `04_FINOPS_MODELOPS.md` e `04_cost_model.csv` | Tarifas, roteamento e modelo de custo; a seção 9 traz o custo depois das decisões |
| `05_ROADMAP_REVISADO.md` e `05_backlog_proposto.csv` | Roadmap e backlog conciliados |
| `06_MCP_SPEC.md` | Especificação normativa do MCP de governança |
| `07_DECISIONS_REQUIRED.md` e `08_CHANGE_PROPOSALS.md` | Decisões e propostas originais, com nota de situação |
| `09_SOURCES.md` | Fontes externas e pontos sem verificação |
| `10_AUDIT_STATUS.json` | Estado em formato de máquina |
| `11_CONCILIACAO.md` | Registro das decisões do responsável e de seus efeitos |
| `tools/` | Scripts que refazem os cálculos e as conferências |
