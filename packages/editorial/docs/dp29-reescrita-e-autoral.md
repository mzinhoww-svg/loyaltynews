# DP-29 na fábrica: reescrita no tom do projeto, fonte secundária e conteúdo autoral

Diretriz do proprietário (DP-29, 23/11/2026): maximizar fontes; nunca reproduzir; a IA lê e redige com outras palavras, no tom de voz do projeto; priorizar blogs especializados ancorados no que as fontes oficiais confirmam; gerar conteúdo autoral quando houver espaço. Limite mantido: não contornar bloqueios técnicos (403, CAPTCHA, robots, rate limit).

## 1. Tom de voz e reescrita (prompts `editorial-0.2`)

- **Não existe guia de estilo aprovado no projeto** (busca em `pacote-v2.1-completo` e no registro de decisões). A fábrica usa o tom **`tom-0.1`, provisório** (`TOM_DE_VOZ` em `src/factory/prompts.ts`): português do Brasil, direto, voz ativa, sóbrio (sem "imperdível", sem exclamação, sem emoji), termos de nicho explicados na primeira vez, título informativo de até 90 caracteres, neutro frente a marcas, sem recomendação de compra, números com unidade e data. **Pendência:** Editor-chefe/UI-UX validam ou trocam o texto; basta editar `TOM_DE_VOZ`.
- O tom entra na redação, na revisão e no pacote social; **não** entra na triagem nem na checagem de fatos.
- Regra 3 (reescrita): "nunca reproduza a fonte", no máximo **5** palavras seguidas iguais (o prompt) e o **gate `copy_literal`** (determinístico, não depende do modelo): fonte primária barra 8 palavras iguais seguidas ou 30% de 5-gramas; **fonte secundária** (blog) barra **6** e **20%**.
- Regra 6 (nível da fonte): cada evidência chega ao modelo com `tier` (`primary` ou `secondary`); o modelo só pode afirmar como fato, ou usar número, data ou citação, o que uma evidência `primary` confirma. O gate repete a regra sem confiar no modelo.

## 2. Fonte secundária (blog, imprensa de nicho): pista, não prova

- `SourceKind` ganhou `blog`, `trade_media` e `company_blog` (nível `secondary`); os demais são `primary`. A evidência registra `sourceTier` e os links do post (`outboundLinks`, até 25).
- **Âncora (`src/factory/anchor.ts`):** para um post secundário, a fábrica coleta, pelo coletor normal (robots, ritmo, anti-SSRF), as páginas que o próprio post linka e que pertencem a uma **fonte primária habilitada** (host e prefixo de caminho conferem; até 3). Link para fonte primária não habilitada ou para site desconhecido não ancora.
- **Sem âncora, a matéria não segue:** fica `bloqueado` com `unanchored` **antes** de qualquer chamada de modelo (não gasta custo).
- **Gates (`rules.ts`):** `needs_primary_anchor` (matéria só com fonte secundária) e `unanchored_claim` (número, data ou citação sustentado só pelo blog). O blog continua listado no bloco "Fontes:" com link (atribuição).
- Limite conhecido: a âncora depende de o post linkar a fonte oficial. Posts que só citam a fonte sem link não viram matéria; achar a fonte oficial por busca no cadastro (mesma empresa/tema) é uma melhoria futura, não feita.

## 3. Conteúdo autoral (pauta própria)

- Entrada: `PautaAutoral` (zod, `.strict()`): `id` (slug), `titulo`, `angulo`, `formato` (`analise` | `explicador` | `comparativo`), `editoria`, `ancoras` (2 a 8 URLs https de **fontes primárias habilitadas**). **Quem propõe a pauta é uma pessoa da redação**; a fábrica não escolhe tema sozinha.
- `runAutoral(deps, pauta)` (`src/factory/autoral.ts`): exige as flags `editorialCollector` e `editorialPipeline`; coleta as âncoras pelo coletor; sem 2 âncoras primárias, `bloqueado` (`autoral_invalid`) sem chamar modelo; senão contexto → redação com o prompt autoral → checagem em provedor distinto → revisão. Termina em `aprovado` ou `bloqueado`; **não emite recibo nem publica**. Pauta repetida (mesmo `id`) devolve `ja_existe`.
- O rascunho sai com `tipoConteudo = 'analise'`, `autoral = { formato, pautaId }`, **sem imagem de fonte** (D08) e com o aviso fixo no início (o sistema o acrescenta; o gate exige): "Conteúdo autoral da Redação Loyalty News: análise feita a partir de fontes oficiais citadas ao final; não é recomendação de compra, investimento ou contratação."
- **Gate autoral:** ≥ 2 páginas primárias distintas realmente usadas (blog não conta), aviso presente, tipo `analise`, **nenhuma citação/fala** (não há entrevista). Valem também todos os gates comuns: números e datas nas evidências, nenhuma apuração/entrevista inventada, assinatura institucional, cópia.
- Não faz: previsão, ranking sem critério, recomendação (o prompt proíbe; o gate cobre fala, número, data e cópia, não "opinião" em geral: a revisão humana segue necessária).

## 4. O que não está feito (para o PM decidir)

- Ainda não há tela do Studio nem entrada no worker para **propor pautas autorais**; `runAutoral` é função testada (a integração fica com Backend/Studio).
- O tom `tom-0.1` e o aviso autoral precisam de validação editorial.
- Nenhum modelo real foi chamado: a qualidade da reescrita no tom e a taxa de reprovação nos gates (`copy_literal` 6/20% para blog) só aparecem na primeira rodada real em staging.
- A pesquisa dos blogs é mecânica (ver `fontes-blogs.md`); a habilitação é humana.
