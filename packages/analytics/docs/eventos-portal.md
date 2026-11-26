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
- Busca é o único texto livre: aparado, espaços colapsados, cortado em 120 caracteres, e vira `:redigido` se parecer
  e-mail, CPF, telefone ou UUID. O termo nunca é ligado a sessão, conta ou IP.
- `fromLegacyCollect` traduz o formato antigo da rota (`{ t: 'pageview', path, ref, w }`) para `page_view`, sem quebrar
  o cliente atual.

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
| Cliente do portal disparar `article_read` (30 s/75%) e `search` | **não** | Frontend, atrás do consentimento de medição |
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
