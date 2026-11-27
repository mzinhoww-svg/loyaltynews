# Contrato de eventos do portal e ensaio do adaptador mLabs

Contrato em `packages/analytics/src/portal-events.ts` (exportado por `@ln/analytics`). Testes em
`packages/analytics/src/__tests__/portal-events.test.ts`. Ensaio do mLabs em
`packages/growth/src/__tests__/mlabs-dryrun.test.ts`.

## Eventos

| Evento | Propriedades | Quando dispara | PII |
|---|---|---|---|
| `page_view` | `path`, `referrer?`, `device?` | uma vez por navegação, depois do consentimento; `path` normalizado (sem query/fragmento, identificador vira `:id`) | nenhum |
| `article_read` | `slug`, `editoria`, `readSeconds` | uma vez por matéria por sessão, ao passar de 30 s de leitura ativa ou 75% do texto, o que vier primeiro; não dispara em prévia, paywall ou leitura de robô | nenhum |
| `search` | `query`, `resultCount`, `editoria?` | uma vez por busca executada (Enter ou botão), com o termo redigido e truncado; não dispara em busca vazia nem em sugestão automática | nenhum |

Regras do contrato:

- Schema fechado (`.strict()`): campo fora da lista é recusado.
- Campo com nome de dado pessoal (`email`, `nome`, `telefone`, `cpf`, `token`, `cookie`, `session`, `user_id`, `autor`…)
  é recusado **antes** do schema, com código `campo_pessoal`. `name` não entra na lista porque é o nome do evento.
- `readSeconds` entre 3 e 3600; `resultCount` entre 0 e 1000; `slug` só `[a-z0-9-]` (até 120).
- **A matéria é identificada pelo slug.** A rota pública não expõe id interno ("nada interno (id, status…) sai por aqui",
  `apps/web/app/api/_lib/articles.ts`), então `articleId` não faz parte do contrato e é recusado como campo desconhecido.
  `articleReadFromPublic(payload, readSeconds)` monta o evento só com `slug` e `editoria` do payload público.
- Busca é o único texto livre: aparado, espaços colapsados e **redigido antes do corte** (e-mail, CPF, telefone ou UUID
  no texto inteiro viram `:redigido`; só depois vem o limite de 120 caracteres). O termo nunca é ligado a sessão, conta ou IP.
- `fromLegacyCollect` traduz o formato antigo da rota (`{ t: 'pageview', path, ref, w }`) para `page_view`, sem quebrar
  o cliente atual.

## Ligação no portal

Os três eventos têm ponto de emissão. **Em execução estão desligados** (flag `analytics`, sem variável que a ligue) e **não
têm destino externo**: com a flag ligada e consentimento, o evento validado só vira o `CustomEvent` `ln:evento-portal`
dentro da página. Nada vai para rota de coleta, agregado ou GA4. Caminhos relativos a `apps/web/`.

| Evento | Estado | Onde é montado na página | Onde é emitido |
|---|---|---|---|
| `page_view` | ligado (3 de 3) | `app/(portal)/layout.tsx:67` | `app/(portal)/_medicao/Medicao.ts:10` (monta em `:17`) |
| `article_read` | ligado, fora de matéria de demonstração | `app/(portal)/noticia/[slug]/page.tsx:101` | `app/(portal)/_medicao/Medicao.ts:44` (envia em `:62`) |
| `search` | ligado, só busca respondida e na 1ª página | `app/(portal)/busca/page.tsx:29` | `app/(portal)/_medicao/Medicao.ts:33` (envia em `:35`) |

Porta única: `app/(portal)/_medicao/emissor.ts:14` (`podeMedir`: flag, consentimento vigente, sem GPC/DNT, sem navegador
automatizado) e `:29` (`emitir`: carrega o contrato, valida, confere de novo e entrega). Teste: `lib/medicao.test.ts`.

Limites desta ligação:

- O banner de consentimento só aparece na produção indexável com `NEXT_PUBLIC_GA_ID`; sem ele ninguém consegue aceitar e
  nada é medido. O texto do banner fala em cookies do Google Analytics: usar o mesmo aceite para estes eventos pede revisão legal.
- A carga do GA4 que já existia (`_consentimento/Consentimento.tsx`) **não depende** da flag `analytics` e não foi alterada.
- Sem fila: o que acontece antes do aceite se perde, inclusive a visualização da página em que se aceitou.
- `article_read` é uma vez por matéria por carga do portal (memória; recarregar conta de novo). "Leitura ativa" = aba visível.
- `page_view`: mudar só a query não conta; segmento com mais de 48 caracteres vira `:id` (regra do contrato), o que atinge
  slugs longos de matéria; perfil de pessoa e movimentação saem como `:id`; endereço inexistente também é contado, com o
  caminho normalizado, que pode conter texto digitado por quem acessou.
- Peso: o contrato (com o zod) é um pedaço separado, baixado só quando pode medir; num empacotamento de conferência com esbuild
  deu cerca de 480 KB minificado, 101 KB com gzip. Não medido no build do Next. Reduzir antes de ligar a flag.
- `search`: `resultCount` é limitado a 1000; repetir o mesmo termo sem recarregar a página não conta de novo.

## Adaptador mLabs (dry-run)

O teste exercita o modo real do publicador (confirmação `LIVE_ACK`, identidade `publisher_social`, flag ligada) com um
transporte que só registra a chamada. Prova:

- `create_post` com `channels: ["linkedin"]`, texto do pacote com UTM, `imageIds` da imagem aprovada e `status: "draft"`;
- nenhum `scheduledAt` (regra do PM: rascunho ou aprovação por link, nunca agendamento direto);
- idempotência: mesma chave não gera segunda chamada e devolve o mesmo recibo; chave nova gera `requestId` novo;
- nenhum e-mail ou campo pessoal no payload.

O mapeamento usado no teste é **de teste**. O mapeamento de produção de `create_post` continua pendente (depende de
R1-05/R5-02), e o adaptador real recusa publicar sem ele.

## O que falta para ligar em produção

| Peça | Estado | Depende de |
|---|---|---|
| Rota `POST /api/analytics/collect` aceitar `article_read` e `search` | **não** — hoje só `pageview` | Backend/Integration: união de schemas + colunas no agregado (o agregado é por dia, caminho, referrer e dispositivo) |
| Cliente do portal emitir os três eventos | **sim, desligado** (ver "Ligação no portal") | ligar a flag: PM/proprietário |
| Destino dos eventos (rota própria ou outro) | **não** | decisão do PM; rota é do Backend |
| Consentimento por finalidade | existe (`consent.ts`) | revisão de texto legal |
| GA4 | **desligado** | gate do proprietário; o contrato não depende dele |
| Flag de medição | existe (`analytics`) | decisão do PM/proprietário |
| Adaptador mLabs real | dry-run coberto; escrita real sem mapeamento | token de servidor (proprietário) + mapeamento (R1-05/R5-02) + envio de mídia |
| Retenção e revisão de PII | retenção existe no agregado | revisão periódica do QA 6 |

Nada aqui publica, agenda ou chama o mLabs de verdade.

## Comandos

```
npx vitest run packages/analytics/src/__tests__/portal-events.test.ts packages/growth/src/__tests__/mlabs-dryrun.test.ts
npm run typecheck
npm run lint
```
