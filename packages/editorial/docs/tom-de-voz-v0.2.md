# Guia de tom de voz do Loyalty News — proposta v0.2 (para validação do UI/UX Director)

**Status (23/11/2026): ADOTADO COMO VERSÃO DE TRABALHO pelo PM**, com os ajustes do parecer do UI/UX Director (seção 7). Está no prompt `editorial-0.3` (`tom-0.2`, `src/factory/prompts.ts`) e no "tom lint" (`src/rules/tone.ts`). O proprietário pode vetar ou ajustar ao ler as matérias do piloto. Não existe guia de estilo aprovado no projeto: tudo abaixo é decisão a confirmar, não fato.

**Todos os exemplos são fictícios** (empresas, números e datas inventados só para ilustrar o estilo). Nenhum vem de matéria real.

## 1. Quem fala

O **Redação Loyalty News** é uma redação institucional (sem nome de pessoa), que acompanha fidelidade, milhas, cartões, varejo, viagem e CRM. Fala com quem usa esses programas no dia a dia e com quem trabalha no mercado. Tom: **claro, preciso, sóbrio e útil**; nunca vendedor, nunca professoral.

Cinco princípios (em ordem de prioridade):
1. **Verdade antes de estilo.** O tom nunca justifica número, data ou fala que a fonte não traz.
2. **O leitor primeiro.** O 1º parágrafo diz o que aconteceu, com quem e a partir de quando; depois, o que muda para o consumidor.
3. **Atribuição sempre.** Todo fato tem dono ("segundo o comunicado da empresa X"); opinião da redação vem rotulada.
4. **Neutro frente a marcas.** Sem elogio, sem crítica própria, sem recomendação de compra, cartão ou programa.
5. **Precisão em vez de impacto.** Verbos concretos, números com unidade e data, sem adjetivo de propaganda.

## 2. Regras de escrita

| Tema | Regra |
|---|---|
| Voz e frase | Voz ativa; frases de até ~25 palavras; parágrafos de 2 a 4 linhas; um assunto por parágrafo. |
| Título | Informativo, até 90 caracteres, com sujeito e verbo; sem pergunta retórica, sem "veja", "saiba", "confira", sem pontos de exclamação. |
| Abertura (lide) | Quem, o quê, quando e onde numa ou duas frases; nada de contexto antes do fato. |
| Contexto | 2º ou 3º parágrafo; só o que as evidências sustentam. |
| "O que muda" | Bloco curto para o consumidor, **somente** se a fonte descreve o efeito; senão, omitir (nunca deduzir). |
| Números | Unidade e referência: "2 pontos por real gasto", "R$ 1.250,00", "12 meses". Separador brasileiro; sem arredondar para parecer maior; sem "até" sozinho quando a fonte traz condição. |
| Datas | "1º de dezembro de 2026", "a partir de 1º/12"; evitar "hoje", "ontem", "semana que vem" sem data (a matéria vive mais que o dia). |
| Siglas e termos | Explicar na 1ª vez, em meia frase: "transferência bonificada (com bônus de pontos)". Manter "pontos" e "milhas" como a fonte usa; não trocar um pelo outro. |
| Atribuição | "segundo", "de acordo com", "informou", "afirmou" (para fala literal, entre aspas e com o autor). Evitar "revelou", "bomba", "polêmica". |
| Incerteza | Dizer o que não se sabe: "a empresa não informou o prazo". Nunca preencher a lacuna. |
| Aviso financeiro | Em conteúdo sobre cartão/investimento: "não é recomendação de compra, investimento ou contratação" (já é o aviso fixo do conteúdo autoral). |
| Proibido | Emoji; "imperdível", "corra", "bomba", "incrível", "revolucionário", "exclusivo" (sem prova); superlativos sem fonte; segunda pessoa imperativa de venda ("aproveite!"); gíria de marca; clickbait. |

## 3. Antes e depois (exemplos fictícios)

**1. Título**
- Antes (propaganda): "BOMBA! Programa Alfa libera bônus INCRÍVEL de 100% e você precisa aproveitar já"
- Depois: "Programa Alfa oferece bônus de 100% em transferências até 15 de dezembro"
- Por quê: fato, número e prazo; sem apelo.

**2. Abertura**
- Antes: "O mercado de milhas está em constante transformação e, nesse cenário, os programas disputam a atenção dos clientes. Nesta segunda, algo importante aconteceu."
- Depois: "O Programa Alfa anunciou nesta segunda-feira (23) um bônus de 100% nas transferências de pontos de cartões parceiros, válido até 15 de dezembro, segundo comunicado da empresa."
- Por quê: o fato vem na 1ª frase, com dono e data.

**3. Atribuição e incerteza**
- Antes: "Tudo indica que o benefício vai durar bastante e deve valer para todos os clientes."
- Depois: "O comunicado não informa se o bônus vale para todos os clientes nem se haverá prorrogação."
- Por quê: nada de dedução; a lacuna fica explícita.

**4. Número**
- Antes: "Cliente ganha uma enxurrada de pontos nas compras."
- Depois: "O acúmulo será de 2 pontos por real gasto em lojas físicas e no aplicativo, a partir de 1º de dezembro de 2026."
- Por quê: unidade, condição e data.

**5. Termo de nicho**
- Antes: "A transferência bonificada com paridade 1:1 pode ser vantajosa para o CPM."
- Depois: "A transferência bonificada (em que o programa soma um bônus aos pontos transferidos) mantém a proporção de 1 ponto do banco para 1 milha da companhia, conforme o regulamento."
- Por quê: explica o termo e atribui; sem juízo de "vantajoso". (O termo "CPM" some: só entra se a fonte o usar e for explicado.)

**6. Reescrita sem copiar a fonte** (fonte fictícia: "A Varejista Beta anuncia parceria estratégica que amplia as opções de acúmulo para os participantes")
- Antes (cópia): "A Varejista Beta anunciou parceria estratégica que amplia as opções de acúmulo para os participantes do programa."
- Depois: "Quem participa do programa passa a pontuar também nas compras da Varejista Beta, segundo a empresa."
- Por quê: ideia da fonte, frases próprias (o gate `copy_literal` barra 8 palavras iguais; 6 se a fonte for blog).

**7. Recomendação disfarçada**
- Antes: "Vale muito a pena migrar para o cartão Gama antes que acabe."
- Depois: "O cartão Gama passa a oferecer 1,5 ponto por dólar gasto a partir de janeiro, informou o banco; a anuidade não mudou."
- Por quê: fato e dado, sem juízo; a decisão é do leitor.

**8. Fonte secundária (blog)**
- Antes: "O blog X garante que o programa vai acabar com o benefício em março."
- Depois: "O blog X afirma que o benefício termina em março; o programa não confirmou a data." (ou: não publicar o número se não houver fonte oficial; o gate `unanchored_claim` impede número, data ou citação sustentados só por blog.)

## 4. Formatos

- **Notícia / flash:** lide + 2 a 4 parágrafos curtos; "o que muda" opcional; bloco "Fontes" gerado pelo sistema (não escrever).
- **Explicador (autoral):** começa pelo "o que é e por que importa agora"; define cada termo; seções curtas ("Como funciona", "Quem é afetado", "O que a fonte não informa"); sem previsão.
- **Comparativo (autoral):** declara o critério no 1º parágrafo ("com base nos regulamentos citados") e compara só o que as evidências trazem para todos os itens; sem ranking de "melhor".
- **Análise (autoral):** separa fato (com evidência) de leitura da redação; a leitura é rotulada ("na leitura da Redação") e **não traz número novo**.

## 5. Como isso vira regra na fábrica

- **Prompt (texto exato proposto para `TOM_DE_VOZ`, versão `tom-0.2`):** as seções 1 e 2 em forma de lista curta (≤ 20 linhas), mais 3 pares antes/depois (títulos, lide, incerteza). Entra só na redação, revisão e pacote social.
- **O que o modelo não decide:** fatos, números, datas, fontes, assinatura e tipo continuam do sistema e dos gates (`checkClaims`, `checkBodyGrounding`, `copy_literal`, `needs_primary_anchor`).
- **Proposta opcional de verificação determinística ("tom lint"):** um gate barato, sem modelo, que reprova ou avisa (a decidir) emoji, "!", palavras da lista proibida (§2), título > 90 caracteres, título com "veja/saiba/confira", e datas relativas sem data absoluta. Não implementado: depende da sua decisão de ser **bloqueio** ou **aviso ao revisor**.

## 6. Decisões que preciso do UI/UX Director / Editor-chefe

1. A lista de **palavras proibidas** (§2) está certa? Quer mais ou menos itens?
2. **Título:** o limite de 90 caracteres e a proibição de "veja/saiba/confira" ficam?
3. **Tratamento do leitor:** impessoal (como acima) ou "você" em explicadores? (Proposta: impessoal em notícia, "você" permitido só em explicador.)
4. O "tom lint" (§5) deve **bloquear** ou só **avisar** o revisor?
5. Existe outro texto do projeto (manifesto, voz da marca, exemplos de matérias que vocês consideram "a cara do Loyalty News") que eu devo usar no lugar desta proposta?

Enquanto não houver resposta, a fábrica continua com o `tom-0.1`.

## 7. Parecer do UI/UX Director (23/11/2026) — identidade e interface; a aprovação editorial final é do Editor-chefe/proprietário

1. **Palavras proibidas:** de acordo com a lista; "exclusivo" e "revolucionário" valem **fora de citação literal e de nome próprio de produto** (evita falso positivo).
2. **Título:** manter a proibição de "veja/saiba/confira"; **teto de 90 caracteres** (não quebra o layout: card grande até 4 linhas, pequeno até 5) e **meta de até 70** para a home ficar escaneável.
3. **Tratamento do leitor:** impessoal em notícia; "você" só em explicador.
4. **Tom lint — dividir:**
   - **BLOQUEAR** (objetivo, sem falso positivo): emoji; "!" no título; título acima de 90 caracteres; título começando por "veja", "saiba" ou "confira".
   - **AVISAR o revisor** (depende de contexto): palavras proibidas no corpo; data relativa sem data absoluta; "você" em notícia.
5. **Texto de voz da marca:** não existe manifesto, guia de voz nem matérias-modelo aprovadas nos materiais do projeto (só a assinatura do Brandkit e a frase em inglês do rodapé, que **não** entra em matéria em pt-BR). Se existirem, só o proprietário ou o PM podem fornecer. "Redação Loyalty News" já é o autor institucional nas bylines do portal.

**Estado:** adotada como versão de trabalho pelo PM (decisão de 23/11/2026) e implementada: prompt `editorial-0.3` com `tom-0.2` e **tom lint** em `src/rules/tone.ts`.
- **BLOQUEIA** (entra no gate do rascunho; a matéria é barrada na 1ª redação, sem nova tentativa: barreira determinística não se resolve repetindo a chamada; o achado fica no registro para o editor): emoji; "!" no título; título com mais de 90 caracteres; título começando por veja/saiba/confira; a frase em inglês do rodapé da marca dentro da matéria.
- **AVISA o revisor** (`avisosDeTom` em `getArticleReview`, sem bloquear): palavra proibida no título ou corpo (fora de citação literal e de nome próprio de produto); data relativa sem data absoluta no parágrafo; "você" fora de explicador; título entre 71 e 90 caracteres (meta de 70); "veja/saiba/confira" no meio do título.
- **Não se aplica** à correção de matéria já publicada (não reprova texto antigo). Símbolos ©, ® e ™ não contam como emoji.
- Limites: o nome próprio de produto é detectado por heurística (palavra proibida entre palavras com inicial maiúscula); data relativa é conferida por parágrafo; o lint não julga fato nem tom subjetivo.
