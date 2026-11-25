# Estados honestos das telas do LN Studio

Inventário das rotas `/studio/*` do app web em 46 telas: cada uma tem carregamento que termina, estado de
vazio explícito (texto do que falta, 404 de registro inexistente ou "não há coleção" em formulário) e estado de erro com
ação de tentar de novo. Nenhum número é estimado quando a leitura falha.

## Como os estados são entregues

- **Carregamento:** fallback compartilhado em `app/studio/(protegido)/loading.tsx` (dentro do layout, menu e sessão
  permanecem) e em `app/studio/entrar/loading.tsx`; as telas com `loading.tsx` próprio continuam com o delas. O fallback
  termina quando a tela chega; não há "Carregando…" eterno de componente cliente.
- **Erro:** `app/studio/error.tsx` e `app/studio/(protegido)/error.tsx` mostram a razão curta e o botão **Tentar de novo**
  (`reset()`). Erros de leitura tratados na página usam `Recarregar` (`app/studio/_components/Recarregar.tsx`), que
  recarrega a URL atual preservando filtros. Formulários devolvem o erro no próprio formulário e permitem enviar de novo.
- **Vazio:** listas usam `st-empty`/texto explícito; detalhes usam `notFound()` (404 explícito); formulários não têm
  coleção a esvaziar. Painéis sem backend dizem o que falta e nunca mostram zero inventado.

## Inventário

| # | Rota | Carregamento | Vazio | Erro com nova tentativa |
|---|---|---|---|---|
| 1 | `/studio/[modulo]` | compartilhado | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 2 | `/studio/agenda` | próprio | texto explícito | inline + "Tentar de novo" |
| 3 | `/studio/auditoria` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 4 | `/studio/campanhas/[id]` | compartilhado | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 5 | `/studio/campanhas` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 6 | `/studio/cms/[id]/corrigir-fabrica` | compartilhado | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 7 | `/studio/cms/[id]` | compartilhado | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 8 | `/studio/cms/checagem/[articleId]` | compartilhado | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 9 | `/studio/cms/checagem` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 10 | `/studio/cms/correcoes/[id]` | compartilhado | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 11 | `/studio/cms/correcoes` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 12 | `/studio/cms/nova` | compartilhado | n/a: formulário (não há coleção a esvaziar) | ação devolve o erro no próprio formulário |
| 13 | `/studio/cms` | compartilhado | texto explícito | inline + "Tentar de novo" (400 = filtro; 5xx = leitura) |
| 14 | `/studio/cms/pautas` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 15 | `/studio/conta` | compartilhado | n/a: formulário (não há coleção a esvaziar) | ação devolve o erro no próprio formulário |
| 16 | `/studio/correcoes-titular/[id]` | compartilhado | 404 explícito (`notFound`) | inline + "Tentar de novo" |
| 17 | `/studio/correcoes-titular` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 18 | `/studio/creative` | próprio | texto explícito | inline + "Tentar de novo" |
| 19 | `/studio/crm/anunciantes/[id]` | compartilhado | texto explícito ("Anunciante não encontrado.") | inline + "Tentar de novo" |
| 20 | `/studio/crm` | próprio | texto explícito | error boundary + "Tentar de novo" |
| 21 | `/studio/decisoes` | compartilhado | texto explícito | error boundary + "Tentar de novo" |
| 22 | `/studio/entidades/[id]` | compartilhado | 404 explícito (`notFound`) | inline + "Tentar de novo" |
| 23 | `/studio/entidades` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 24 | `/studio/entidades/pessoa/[id]` | compartilhado | 404 explícito (`notFound`) | inline + "Tentar de novo" |
| 25 | `/studio/finops` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 26 | `/studio/fontes/[id]` | compartilhado | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 27 | `/studio/fontes/fabrica` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 28 | `/studio/fontes` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 29 | `/studio/home-menus` | próprio | texto do painel | inline + "Tentar de novo" |
| 30 | `/studio/inventario` | próprio | texto explícito | error boundary + "Tentar de novo" |
| 31 | `/studio/midia` | compartilhado | texto explícito | inline + "Tentar de novo" (400 = filtro; 5xx = leitura) |
| 32 | `/studio/modelops` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 33 | `/studio/organizacao/[id]` | compartilhado | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 34 | `/studio/organizacao` | compartilhado | texto explícito | error boundary + "Tentar de novo" |
| 35 | `/studio/organogramas` | compartilhado | texto explícito | error boundary + "Tentar de novo" |
| 36 | `/studio` | próprio | texto explícito (contagens "—" e aviso, nunca zero inventado) | inline + "Tentar de novo" |
| 37 | `/studio/piloto/[materia]` | compartilhado | 404 explícito (`notFound`) | inline + "Tentar de novo" |
| 38 | `/studio/piloto/importar` | compartilhado | n/a: formulário (não há coleção a esvaziar) | inline + "Tentar de novo" |
| 39 | `/studio/piloto` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 40 | `/studio/piloto/violacoes` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 41 | `/studio/reunioes` | compartilhado | texto explícito | error boundary + "Tentar de novo" |
| 42 | `/studio/seo` | próprio | texto explícito | inline + "Tentar de novo" |
| 43 | `/studio/social/[id]` | compartilhado | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 44 | `/studio/social` | compartilhado | texto explícito | inline + "Tentar de novo" |
| 45 | `/studio/watchlists` | próprio | texto explícito | inline + "Tentar de novo" |
| 46 | `/studio/entrar` | próprio | n/a: formulário (não há coleção a esvaziar) | ação devolve o erro no próprio formulário |

## Contagem

- 46/46 com carregamento que termina.
- 46/46 com estado de erro acionável.
- 29 listas/painéis com texto explícito de vazio ou de registro não encontrado, 13 com 404 explícito (`notFound`) e 4 formulários sem coleção. Cobertura dos aplicáveis: 42/42.
