# Redesenho de custo por matéria (DP-27) — contribuição da Frente 07 (AgentOps)

> GERADO por `packages/agents/src/cost-redesign-doc.ts`; não editar. **Sem chamadas pagas.** O FinOps lidera a consolidação; esta é a contribuição do AgentOps (modelo reproduzível: `src/cost-redesign.ts`, testado). **Premissas, não medições:** perfis de tokens por etapa, frações de economia e volume. **Não verificado:** os limites de uso das assinaturas (Claude, Codex) e dos modelos gratuitos. Preços e IDs: política de modelos (v5; os preços dos candidatos são os mesmos da v6).

## 1. Resumo

- **Premissas leves deste modelo** (≈ 61 mil tokens de entrada por matéria, quase todos lidos do cache): só API tarifada (A, base DP-26) custa **US$ 0.019 por matéria** e **US$ 13.42 / 19.68 / 32.19 por mês** a 15/30/60 matérias por dia (inclui rituais e verificador): coube nos três cenários.
- **Isso NÃO é a conclusão.** O Arquiteto (perfis de ~110–140 mil tokens de entrada por matéria, premissas da auditoria) chega a US$ 0,08 por matéria só com cache e US$ 0,278 sem cache — **4.2× e 8.8× o meu** (com e sem cache) — e a auditoria do FinOps dá US$ 29–37 por mês a 6 matérias por dia. Com esses perfis a API sozinha estoura em 30–60 por dia. **A decisão depende da premissa de tokens por matéria, que ninguém mediu**: ver a sensibilidade (seção 4b) e o piloto de 10 matérias.
- **Robusto às premissas:** (i) com a via OpenBot principal (DP-27) a API tarifada paga só a auditoria por amostragem e o verificador (US$ 0.78–1.61 por mês neste modelo; mesmo multiplicando os tokens por 45 a 60/dia ainda caberia), então o dinheiro deixa de ser o gargalo e o gargalo vira o **limite de uso das assinaturas** (seção 4); (ii) o cache de prompt é obrigatório; (iii) a checagem de fatos por modelo em toda matéria não deve ser amostrada sem decisão (Blueprint §6/WF02).

## 2. Custo por matéria e por mês (API tarifada, esperado), por combinação

Fixo mensal já incluso: rituais na API (nas combinações A, A0, E) e aceites do verificador (≈ US$ 0,50, informado pelo PM). 22 dias úteis por mês. ✓ = cabe nos US$ 50.

| Combinação | API por matéria | 15/dia (US$/mês) | 30/dia | 60/dia | Máx. matérias/dia só na API |
|---|---|---|---|---|---|
| A | US$ 0.0190 | 13.42 ✓ | 19.68 ✓ | 32.19 ✓ | 102 |
| A0 | US$ 0.0314 | 17.54 ✓ | 27.92 ✓ | 48.68 ✓ | 61 |
| B | US$ 0.0010 | 0.82 ✓ | 1.14 ✓ | 1.78 ✓ | 2319 |
| C | US$ 0.0010 | 0.82 ✓ | 1.14 ✓ | 1.78 ✓ | 2319 |
| D | US$ 0.0010 | 0.82 ✓ | 1.14 ✓ | 1.78 ✓ | 2319 |
| E | US$ 0.0109 | 6.41 ✓ | 9.99 ✓ | 17.16 ✓ | 197 |
| F | US$ 0.0010 | 0.82 ✓ | 1.14 ✓ | 1.78 ✓ | 2319 |
| G | US$ 0.0008 | 0.78 ✓ | 1.05 ✓ | 1.61 ✓ | 2678 |

- **A** — A. Base DP-26: tudo na API tarifada (como no desenho atual)
- **A0** — A0. Base DP-26 com falha de cache (referência de risco)
- **B** — B. OpenBot nas assinaturas como via principal (DP-27); API só na auditoria
- **C** — C. B + etapas determinísticas no lugar de modelo (coleta, dedupe, whitelist de fontes, números/fontes)
- **D** — D. B + checagem de fatos por modelo só nas de maior risco (30%)
- **E** — E. Só API, otimizada: determinístico + amostragem + prompts 25% menores + digest nos rituais
- **F** — F. C + modelos gratuitos (OpenCode free) em triagem, social e entidades (qualidade NÃO verificada)
- **G** — G. RECOMENDADA: OpenBot principal + determinístico + checagem por risco + prompts menores; API só auditoria, verificador e excedente

## 3. Demanda das assinaturas (o que as combinações com OpenBot exigem)

Tokens por matéria = entrada + leitura de cache + saída esperada, somando as etapas que rodam no OpenBot (a via **Codex** é a de checagem e revisão: autor diferente do redator Claude, sem custo de API). Por dia = por matéria × volume.

| Combinação | Chamadas por matéria | Claude (tokens/matéria) | Codex (tokens/matéria) | Gratuitos (tokens/matéria) | Total por matéria | Total por dia a 15 / 30 / 60 |
|---|---|---|---|---|---|---|
| B | 12.0 | 44 mil | 19 mil | 0 mil | 64 mil | 956 mil / 1.91 M / 3.83 M |
| C | 7.0 | 28 mil | 19 mil | 0 mil | 47 mil | 705 mil / 1.41 M / 2.82 M |
| D | 11.3 | 44 mil | 13 mil | 0 mil | 57 mil | 854 mil / 1.71 M / 3.42 M |
| F | 3.2 | 11 mil | 19 mil | 17 mil | 47 mil | 705 mil / 1.41 M / 2.82 M |
| G | 6.3 | 21 mil | 10 mil | 0 mil | 31 mil | 463 mil / 927 mil / 1.85 M |

Limites das assinaturas: limite de uso do plano Claude contratado (janelas de uso e teto semanal): NÃO verificado; limite de uso do plano Codex contratado (janelas de uso e teto semanal): NÃO verificado; limites e política de dados dos modelos gratuitos (OpenCode free): NÃO verificados. O Arquiteto relata que o OpenBot não expõe tokens e que o Codex já bateu o limite na implantação: por isso proponho (e ele também) um **piloto de 10 matérias** para medir quantas matérias cabem por janela de limite, antes de fixar qualquer volume.

## 4. O que acontece quando a assinatura bate o limite

| Degrau | Gatilho | Ação |
|---|---|---|
| 1 | a assinatura de uma via (Claude ou Codex) devolve limite de uso ou aviso de janela | o adaptador marca a via como esgotada até o reinício informado e para de despachar a ela; etapas de baixa prioridade (social, entidades, triagem extra) ficam em fila |
| 2 | a via esgotada é a de redação ou a de verificação, e há matéria na fila | a etapa passa à API tarifada pelo gateway, dentro do orçamento (degraus 35/40/42 da política); a checagem de fatos NUNCA é pulada nem feita pelo mesmo autor do redator |
| 3 | a API também atinge o degrau não essencial (US$ 40) ou o teto | só o que é essencial continua (redação com checagem independente de matérias de alto risco); o resto espera a próxima janela |
| 4 | não há via disponível para a checagem independente | falha fechada: a matéria não é publicada; fica em fila com aviso (a publicação pausa, como no ADR-003) |

Quanto a API precisa cobrir (recomendada G, o restante vira API): para caber em US$ 50 a assinatura precisa cobrir pelo menos **0% a 15/dia, 0% a 30/dia, 0% a 60/dia** do trabalho de modelo (auditoria sempre na API). Abaixo disso, o orçamento da API estoura antes do fim do mês e entram os degraus 35/40/42 da política.

## 4b. Sensibilidade: quanto as premissas podem estar erradas

Escala de tokens (todos os perfis multiplicados) até a API tarifada estourar US$ 50 no mês, por combinação só-API e volume. Se o custo real por matéria for X vezes o deste modelo e X for maior que o número da tabela, a combinação **não cabe**.

| Combinação (só API) | 15/dia | 30/dia | 60/dia |
|---|---|---|---|
| A | 6.8× | 3.4× | 1.7× |
| A0 | 4.1× | 2.1× | 1.0× |
| E | 13.2× | 6.6× | 3.3× |

Leitura: a combinação A a 30 por dia só aguenta tokens até 3.4× o deste modelo; o Arquiteto está em ~4.2× (com cache). Por isso a medição real de tokens por matéria (piloto) vem **antes** de fixar volume ou política.

## 5. Cada alavanca avaliada (prós, contras, impacto em qualidade e privacidade)

| Alavanca | Efeito no custo (por matéria, API) | Prós | Contras e riscos | Qualidade / privacidade |
|---|---|---|---|---|
| (1) OpenBot nas assinaturas (B) | US$ 0.019 → 0.001 | custo marginal de API ~zero; Claude redige e Codex checa = autor distinto sem API | limite de uso desconhecido; sem `generation id`/custo conciliável (evidência de identidade do modelo mais fraca); PC ligado; **termos das assinaturas para uso automatizado em produção NÃO verificados**; revoga a regra "assinatura só para implementação" (DP-04/DP-05) | qualidade igual (mesmos modelos); privacidade: DP-27 aceita retenção; **dado pessoal continua fora** até decisão |
| (2) Modelos gratuitos (F) | US$ 0.001 → 0.001 (só tira tokens da assinatura) | alivia o limite das assinaturas em triagem, social e entidades | qualidade NÃO verificada; política de dados dos gratuitos desconhecida; instabilidade de limite | só em etapas de baixo risco e de matéria já publicada; nunca na checagem; atrás de flag (Arquiteto concorda) |
| (3) Cache agressivo, prompts menores, lote | A0→A: US$ 0.031 → 0.019 (cache); prompts −25%: ver E/G | maior alavanca na API; o cache é obrigatório na política | cache precisa ser comprovado por modelo (G2: `cached_tokens > 0`); sem cache a API não cabe | nenhum impacto de qualidade |
| (4) Determinístico no lugar de modelo (C) | US$ 0.001 → 0.001 na API; tira 17 mil tokens/matéria da assinatura | barato, auditável, reproduzível (dedupe, whitelist de fontes, formatação, conferir números e citações contra a fonte) | só funciona onde há regra; exige código e testes | melhora a verificabilidade; não substitui a checagem factual por modelo |
| (5) Checagem por amostragem (D) | tira o custo de checagem das 70% restantes | economiza assinatura e API | **o Blueprint §6/WF02 e o ADR exigem checagem por outro provedor em toda matéria**: amostrar é mudar requisito, não otimizar. Alternativa segura: checagem + editor em UMA chamada (−24% segundo o Arquiteto) e checagem determinística de números/fontes em 100% | amostragem reduz a garantia de qualidade; **só com decisão do proprietário** |

## 6. Recomendação

1. **Via principal OpenBot (G sem o corte de amostragem):** redação (Claude), checagem e revisão (Codex, autor distinto), rituais, social e entidades nas assinaturas; **API tarifada só para auditoria por amostragem, verificador (≈ US$ 0,50) e excedente** quando a assinatura bater o limite.
2. **Não amostrar a checagem de fatos** (requisito do Blueprint); em vez disso: checagem determinística de números e fontes em 100% + checagem e revisão do editor numa chamada só nas matérias de baixo risco + fila por risco quando o limite apertar.
3. **Cache e prompts menores** em toda chamada da API (obrigatório pela política; neste modelo, sem cache a combinação A custa 1.7× mais).
4. **Piloto de 10 matérias antes de fixar o volume**, para medir tokens por matéria, matérias por janela de limite de cada assinatura e a qualidade; só então escolher 15, 30 ou 60 por dia.
5. **Gratuitos:** só social/SEO/entidades de matéria já publicada, atrás de flag, depois de medir a qualidade.

## 7. O que muda na política (DP-26 → DP-27; o Arquiteto edita a v7, eu não toco no contrato protegido)

- **Revogado:** ZDR por chamada como critério de privacidade (DP-26 a). O protocolo de qualificação já trata `QC-ZDR` como informativo.
- **Muda a regra de acesso:** a política v5/v6 diz "acesso medido só via OpenRouter; assinaturas do OpenBot não valem para chamada de modelo do produto". A DP-27 inverte a ordem: **rota OpenBot principal**, API tarifada complementar. A v7 precisa de uma rota `openbot_subscription` e de regras para ela.
- **Evidência e ledger:** a chamada pela assinatura não tem `generation id` nem custo do OpenRouter: precisa de evidência própria (id da execução do agente, modelo informado, tokens estimados) e de um contador de uso (quota, não dinheiro). Autor distinto passa a ser **identidade do agente** (Claude × Codex), mais fraca que o prefixo de `generation.model`.
- **Mantém-se:** sem reserva na redação, Fable fora do não publicado, reserva de US$ 8 só para auditoria, teto de US$ 50 na API, dado pessoal fora até decisão, checagem por outro provedor em toda matéria.
- **ADR-003:** hoje manda toda chamada de modelo passar pelo gateway do LN e pelo OpenRouter; a DP-27 exige emenda do ADR (execução direta pelos agentes do OpenBot).

## 8. Cruzamento com o modelo do Arquiteto

O Arquiteto publicou `fast-track/custo/redesenho-custo-arquiteto.md` (modelo próprio, premissas da auditoria): só API, US$ 0,278 por matéria (sem cache) → 0,042 (tudo aplicado); 15/dia US$ 19, 30/dia US$ 38, 60/dia US$ 75 (estoura). Meus números partem de outro conjunto de premissas (perfis de tokens por etapa do protocolo de qualificação) e dão custo por matéria diferente; **a diferença vem das premissas, não de erro de conta**: cabe ao FinOps reconciliar os dois modelos e travar uma única base. As conclusões coincidem: o cache decide, a API sozinha só aguenta volumes menores, o OpenBot principal resolve o dinheiro e traz o risco de limite, e a checagem por amostragem conflita com o Blueprint.

## 9. Não verificado

- Limites e janelas de uso das assinaturas; se o OpenBot expõe consumo; termos dos provedores para uso automatizado em produção; política de dados dos modelos gratuitos.
- Todos os perfis de tokens, as frações de economia e a premissa de 22 dias úteis por mês; o custo real só se sabe medindo (protocolo de medição e piloto).
- Preços de lista de 22–23/11/2026 (vencem em 7 dias).
