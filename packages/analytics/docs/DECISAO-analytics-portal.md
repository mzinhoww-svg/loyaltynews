# Decisão: medição (analytics) do portal Loyalty News
Para: proprietário. De: Integration Engineer, via Program Manager. Data: 23/11/2026. Estado: **proposta; protótipo pronto, desligado, nada externo ligado.** Não é parecer jurídico: os pontos de LGPD marcados "a confirmar" dependem do parecerista (R0-10/J-15).

## 1. O que você precisa decidir (resumo)
1. Adotar uma **medição própria, agregada, sem cookie e sem dado pessoal** como padrão do portal? **Recomendo sim** (custo zero, nada de terceiro, já funciona no lançamento).
2. Usar **GA4** (Google)? **Recomendo não agora**: só depois do parecer J-15 e, se usar, **opcional e só com consentimento**. Hoje ele não é necessário para o que o mídia kit precisa mostrar.
3. Confirmar com o parecerista a **base legal** da medição própria (legítimo interesse ou consentimento) e publicar a **política de privacidade** antes de ligar a flag. O código **recusa coletar sem política publicada**.

## 2. De onde vêm os requisitos
| Origem | Exigência |
|---|---|
| Backlog **R1-07** (GA4, consentimento e eventos mínimos) | "Evento chega sem dado pessoal"; "nenhum e-mail, nome ou token enviado"; rollback = remover a etiqueta |
| Backlog **R5-10** (métricas) | Cada número com fonte, período e data; conector fora do ar mostra "não disponível" |
| Blueprint §1 (mídia kit) | Métricas com período, origem, horário e sinal de indisponível/desatualizado; **jamais números fictícios** |
| Achado **F-085** | "Tempo real" do GA4 são os últimos 30 minutos; no lançamento o número será próximo de zero |
| Flag `analytics` (`@ln/contracts`) | "Coleta de analytics (J-15: política publicada e consentimento por finalidade)". **Desligada por padrão** |

## 3. Opções
| | **A. GA4 (Google)** | **B. Medição própria agregada (protótipo)** | **C. Ferramenta open source auto-hospedada** (ex.: Plausible CE, Umami, Matomo) | **D. Só logs do servidor** |
|---|---|---|---|---|
| Custo | Sem licença no nível padrão (não verificado nesta rodada) | **Zero** (usa o banco e a infra que já existem) | Software gratuito; **custo de hospedagem e operação** na Vertra (a orçar com o DevOps) | Zero |
| Cookie / identificador | Sim (cookie próprio do GA4 para identificar visitante) | **Nenhum** | Depende da ferramenta/modo (algumas operam sem cookie) | Nenhum cookie; o IP está no log |
| Dado pessoal | Identificador de usuário/dispositivo; envia dados a terceiro (Google) | **Nenhum**: só contagens por dia, caminho, categoria de origem e classe de dispositivo | Depende da configuração | IP e user agent em log |
| LGPD | Tende a exigir **consentimento** (cookie não essencial; terceiro; possível transferência internacional): a confirmar | Base candidata: legítimo interesse, **a confirmar**; respeita GPC/DNT | A confirmar, conforme o modo | IP é dado pessoal: precisa de retenção curta e base |
| Tempo real | Sim, mas só os **últimos 30 min** (F-085) | Não (agregado diário; pode ser horário depois) | Em geral sim | Não |
| Visitantes únicos, sessões, funil, geografia | Sim | **Não** (decisão deliberada de privacidade) | Sim (varia) | Não confiável |
| Esforço | Baixo para ligar; **alto para ficar em conformidade** (banner, política, DPA, transferência) | **Pronto como protótipo**; falta rota HTTP, tabela e beacon no portal | Médio/alto (deploy, atualização, backup) | Baixo, mas pouco útil |
| Risco principal | Consentimento mal configurado; dependência de terceiro | Números **menores e diferentes** do GA4 (sem únicos); bots inflam | Operar mais um serviço | Dado pessoal em log |

Retenção do GA4, para referência (documentação do Google, consultada em 23/11/2026): dados de evento de nível de usuário ficam por **2 ou 14 meses**, à escolha; o GA4 **não grava o endereço IP bruto** (usa o IP para derivar localização aproximada). Isto **não elimina** a questão do cookie e do consentimento.
Sobre cookies, a **ANPD publicou um Guia Orientativo em 18/10/2022**; a leitura secundária indica que cookies não essenciais não podem vir ligados por padrão e que "aceitar" e "rejeitar" devem ter o mesmo destaque. **Não confirmei** o que o guia diz sobre cookies estatísticos: o parecerista deve ler o PDF oficial.

## 4. Recomendação
- **Padrão: opção B** (o protótipo). Atende ao que o mídia kit e o R5-10 pedem (número com fonte, período e horário; "não disponível" quando não há dado) sem cookie nem dado pessoal.
- **GA4: adiar.** Se mais tarde você quiser visitantes únicos, geografia ou funil, ele entra **como camada opcional**, atrás de uma segunda flag (`analyticsThirdParty`, desligada), **só com consentimento explícito por finalidade**, na versão vigente da política, e nunca com GPC/DNT. O protótipo já tem essa porta (`thirdPartyMeasurementAllowed`) e **não carrega nenhum script externo**.
- **Opção C** só se, com o tempo, B ficar curta e você quiser mais relatórios sem usar o Google; exige decisão de infra e orçamento.
- **Opção D** não serve como medição de audiência.

## 5. O que o protótipo faz (cada linha tem teste)
| Garantia | Como |
|---|---|
| Sem cookie, armazenamento do navegador, fingerprint nem terceiros | Teste varre o código-fonte: nenhum `cookie`, `localStorage`, `fetch`, biblioteca de analytics, IP, cabeçalho ou user agent |
| Evento mínimo e fechado: 4 campos (`t`, `path`, `ref`, `w`) | Schema estrito: **qualquer campo extra** (e-mail, nome, token, IP, cookie, user agent, idioma…) é recusado com 400, **sem ecoar o valor** |
| Caminho sem dado pessoal | Query e fragmento descartados; e-mail, CPF/telefone, UUID, hexadecimal e token viram `:id` |
| Origem só como categoria | `direto`, `busca`, `social`, `interno`, `outro`; o host e o caminho de origem são **descartados** (teste de host enganoso) |
| Dispositivo sem user agent | Classe pela largura da janela |
| Respeita GPC e DNT | Sinal ligado: **nada é contado** (204) |
| Só agregados | O que persiste é (dia em Brasília, caminho, origem, dispositivo) → contagem. Nenhum evento individual, nenhum horário além do dia |
| Anti-reidentificação | Célula com menos de **5** visualizações não é exibida por dimensão; o total é sempre exato |
| Sem número fictício | Sem dados ou com a coleta desligada: relatório **"indisponível"** com motivo e total `null` (nunca zero) |
| Limite contra spam de caminhos | Acima de 2.000 caminhos distintos por dia, o excedente cai em `:outros` |
| Desligado por padrão e falha fechada | Flag `analytics` desligada → 404 sem efeito; **sem política publicada → 503 sem efeito** |
| Consentimento por finalidade | `medicao_agregada` (sem consentimento, com política e sem GPC/DNT); `medicao_terceiros` e `publicidade` **negadas por padrão**, só com opt-in da **versão vigente** da política; finalidade desconhecida negada |
| Retenção | Agregados por **790 dias (~26 meses)** (proposta); não há dado bruto para reter |
| Liga ao mídia kit | `toMetricRecords` gera registros com origem `ln_first_party`, período, horário e metodologia; o `MetricStore` do Comercial os aceita (teste) |

## 6. O que o protótipo NÃO faz (limites assumidos)
- **Sem visitantes únicos, sessões, funil, retenção de leitores nem geografia.** É escolha de privacidade; se isso for necessário, é a decisão sobre GA4 ou opção C.
- **Sem tempo real** (agregado por dia). No lançamento, o tempo real do GA4 também seria quase zero (F-085).
- **Sem filtro de robôs** nem deduplicação de recarga: a contagem é de visualizações, não de pessoas; robôs a inflam.
- **Sem limite de taxa** na rota (a camada HTTP/proxy precisa ter); o limite de caminhos distintos protege só a memória.
- **Persistência em memória:** a tabela real (`analytics_daily`: dia, caminho, origem, dispositivo, visualizações) e a rota HTTP são do Backend; o pacote entrega handlers puros e uma porta de armazenamento.
- **Nada foi ligado:** nenhuma etiqueta no portal, nenhuma conta, nenhuma chamada externa; a flag `analytics` segue desligada.

## 7. Decisões pedidas
| # | Decisão | Minha recomendação |
|---|---|---|
| D1 | Medição própria agregada como padrão do portal | **Sim** |
| D2 | GA4 | **Não agora**; só opcional, com consentimento e depois do parecer |
| D3 | Base legal da medição própria e texto da política (parecerista, J-15) | Pedir o parecer; publicar a política **antes** de ligar a flag |
| D4 | Retenção dos agregados | 790 dias |
| D5 | Limiar de supressão | k = 5 |
| D6 | Controlador e encarregado (DPO) nomeados na política | Necessário antes de ligar; é dado jurídico, não técnico |

## 8. Plano de ativação (depois da sua decisão)
1. Parecer J-15 e política publicada, com número de versão (o código só coleta com versão vigente).
2. **Backend:** tabela `analytics_daily` e `POST /api/analytics/collect` passando só o corpo e os dois sinais (`Sec-GPC`, `DNT`) a `handleCollect`; **a rota não registra IP, user agent nem cookies**.
3. **DevOps:** confirmar que o proxy/CDN da Vertra **não guarda IP** ou definir retenção curta do log de acesso (**não verificado**: é o ponto onde o IP ainda poderia existir).
4. **Frontend:** beacon de `@ln/analytics/client` (`buildCollectPayload` + `shouldSend`), atrás da flag, sem banner para a medição agregada se o parecer confirmar.
5. Ligar `analytics` **em staging**, medir 7 dias e comparar com o log do servidor (calibração).
6. **Comercial:** `toMetricRecords` → `MetricStore.ingest` (já compatível).
7. **Reversão:** desligar a flag (coleta responde 404; relatório mostra "indisponível").

## 9. Não verificado
Posição da ANPD sobre cookies estatísticos e sobre medição agregada sem cookie; base legal definitiva; se o proxy/CDN da Vertra registra IP; custo e esforço reais de hospedar a opção C; preço e condições atuais do GA4 além do que consta acima; comportamento de robôs no portal real. Nenhuma conta, etiqueta ou serviço externo foi tocado.
