# Estados honestos das telas do LN Studio

Inventário das rotas `/studio/*` do app web em 46 telas: cada uma tem carregamento que termina, estado de
vazio explícito (texto do que falta, 404 de registro inexistente ou "não há coleção" em formulário) e estado de erro com
ação de tentar de novo. Nenhum número é estimado quando a leitura falha.

## Como os estados são entregues

- **Carregamento:** `loading.tsx` só em listas que NUNCA respondem 404 (`_components/Carregando.tsx`); detalhes, listas com filho de detalhe e formulários não têm boundary, porque um boundary abre o streaming antes do `notFound()` e transforma o 404 em 200. A resposta do servidor chega inteira e o estado termina; não há "Carregando…" eterno de componente cliente.
- **Erro:** `app/studio/error.tsx` e `app/studio/(protegido)/error.tsx` mostram a razão curta e o botão **Tentar de novo**
  (`reset()`). Erros de leitura tratados na página usam `Recarregar` (`app/studio/_components/Recarregar.tsx`), que
  recarrega a URL atual preservando filtros. Formulários devolvem o erro no próprio formulário e permitem enviar de novo.
- **Vazio:** listas usam `st-empty`/texto explícito; detalhes usam `notFound()` (404 explícito); formulários não têm
  coleção a esvaziar. Painéis sem backend dizem o que falta e nunca mostram zero inventado.

## Inventário

| # | Rota | Carregamento | Vazio | Erro com nova tentativa |
|---|---|---|---|---|
| 1 | `/studio/[modulo]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 2 | `/studio/agenda` | próprio | texto explícito | inline + "Tentar de novo" |
| 3 | `/studio/auditoria` | próprio | texto explícito | inline + "Tentar de novo" |
| 4 | `/studio/campanhas/[id]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 5 | `/studio/campanhas` | aguarda a resposta (sem boundary; preserva 404) | texto explícito | inline + "Tentar de novo" |
| 6 | `/studio/cms/[id]/corrigir-fabrica` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 7 | `/studio/cms/[id]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 8 | `/studio/cms/checagem/[articleId]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 9 | `/studio/cms/checagem` | aguarda a resposta (sem boundary; preserva 404) | texto explícito | inline + "Tentar de novo" |
| 10 | `/studio/cms/correcoes/[id]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 11 | `/studio/cms/correcoes` | aguarda a resposta (sem boundary; preserva 404) | texto explícito | inline + "Tentar de novo" |
| 12 | `/studio/cms/nova` | n/a (sem leitura) | n/a: formulário (não há coleção a esvaziar) | ação devolve o erro no próprio formulário |
| 13 | `/studio/cms` | aguarda a resposta (sem boundary; preserva 404) | texto explícito | inline + "Tentar de novo" (400 = filtro; 5xx = leitura) |
| 14 | `/studio/cms/pautas` | próprio | texto explícito | inline + "Tentar de novo" |
| 15 | `/studio/conta` | n/a (sem leitura) | n/a: formulário (não há coleção a esvaziar) | ação devolve o erro no próprio formulário |
| 16 | `/studio/correcoes-titular/[id]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | inline + "Tentar de novo" |
| 17 | `/studio/correcoes-titular` | aguarda a resposta (sem boundary; preserva 404) | texto explícito | inline + "Tentar de novo" |
| 18 | `/studio/creative` | próprio | texto explícito | inline + "Tentar de novo" |
| 19 | `/studio/crm/anunciantes/[id]` | herdado | texto explícito ("Anunciante não encontrado.") | inline + "Tentar de novo" |
| 20 | `/studio/crm` | próprio | texto explícito | error boundary + "Tentar de novo" |
| 21 | `/studio/decisoes` | próprio | texto explícito | error boundary + "Tentar de novo" |
| 22 | `/studio/entidades/[id]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | inline + "Tentar de novo" |
| 23 | `/studio/entidades` | aguarda a resposta (sem boundary; preserva 404) | texto explícito | inline + "Tentar de novo" |
| 24 | `/studio/entidades/pessoa/[id]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | inline + "Tentar de novo" |
| 25 | `/studio/finops` | próprio | texto explícito | inline + "Tentar de novo" |
| 26 | `/studio/fontes/[id]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 27 | `/studio/fontes/fabrica` | próprio | texto explícito | inline + "Tentar de novo" |
| 28 | `/studio/fontes` | aguarda a resposta (sem boundary; preserva 404) | texto explícito | inline + "Tentar de novo" |
| 29 | `/studio/home-menus` | próprio | texto do painel | inline + "Tentar de novo" |
| 30 | `/studio/inventario` | próprio | texto explícito | error boundary + "Tentar de novo" |
| 31 | `/studio/midia` | próprio | texto explícito | inline + "Tentar de novo" (400 = filtro; 5xx = leitura) |
| 32 | `/studio/modelops` | próprio | texto explícito | inline + "Tentar de novo" |
| 33 | `/studio/organizacao/[id]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 34 | `/studio/organizacao` | aguarda a resposta (sem boundary; preserva 404) | texto explícito | error boundary + "Tentar de novo" |
| 35 | `/studio/organogramas` | próprio | texto explícito | error boundary + "Tentar de novo" |
| 36 | `/studio` | aguarda a resposta (sem boundary; preserva 404) | texto explícito (contagens "—" e aviso, nunca zero inventado) | inline + "Tentar de novo" |
| 37 | `/studio/piloto/[materia]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | inline + "Tentar de novo" |
| 38 | `/studio/piloto/importar` | n/a (sem leitura) | n/a: formulário (não há coleção a esvaziar) | inline + "Tentar de novo" |
| 39 | `/studio/piloto` | aguarda a resposta (sem boundary; preserva 404) | texto explícito | inline + "Tentar de novo" |
| 40 | `/studio/piloto/violacoes` | próprio | texto explícito | inline + "Tentar de novo" |
| 41 | `/studio/reunioes` | próprio | texto explícito | error boundary + "Tentar de novo" |
| 42 | `/studio/seo` | próprio | texto explícito | inline + "Tentar de novo" |
| 43 | `/studio/social/[id]` | aguarda a resposta (sem boundary; preserva 404) | 404 explícito (`notFound`) | error boundary + "Tentar de novo" |
| 44 | `/studio/social` | aguarda a resposta (sem boundary; preserva 404) | texto explícito | inline + "Tentar de novo" |
| 45 | `/studio/watchlists` | próprio | texto explícito | inline + "Tentar de novo" |
| 46 | `/studio/entrar` | n/a (sem leitura) | n/a: formulário (não há coleção a esvaziar) | ação devolve o erro no próprio formulário |

## Contagem

- 46/46 terminam o carregamento (17 com `loading.tsx` próprio, 1 herdado do pai — `crm/anunciantes/[id]` —, 24 aguardam a resposta inteira de propósito para o 404 continuar 404 e 4 formulários não leem dados).
- 46/46 com estado de erro acionável.
- 29 listas/painéis com texto explícito de vazio ou de registro não encontrado, 13 com 404 explícito (`notFound`) e 4 formulários sem coleção. Cobertura dos aplicáveis: 42/42.

## Vazios renderizados, um a um (composição int/033)

Conferência de 26/11/2026: cada rota foi aberta com o banco de e2e recém-criado (vazio), sessão de admin, esperando o
streaming terminar; o texto abaixo é o que a tela renderizou. 20 têm vazio de coleção/registro; 9 são painel/configuração
onde "vazio de coleção" não se aplica — o texto exibido é o que está na coluna. Nenhuma usa "Sem dados" ou "Nenhum
resultado" genérico, e nenhuma inventa contagem: os zeros de Social e da visão geral vêm da leitura real.

| # | Rota | Tipo | Texto exato renderizado | Mudou? |
|---|---|---|---|---|
| 1 | `/studio/agenda` | coleção | "Nenhum evento cadastrado" — "A agenda está vazia. Cadastre eventos com a fonte oficial abaixo." | confirmado |
| 2 | `/studio/auditoria` | coleção | "Nenhuma ação de auditoria" — "O publicador social ainda não registrou nenhuma tentativa de geração ou publicação neste processo." | corrigido (antes "Nenhum registro" com texto do publicador) |
| 3 | `/studio/campanhas` | coleção | "Nenhuma campanha" — "Nenhuma campanha criada. Campanhas nascem de uma conta do CRM (lead convertido) e de um formato do catálogo." | confirmado |
| 4 | `/studio/cms/checagem` | coleção | "Nenhuma matéria da Fábrica na fila" — "A Fábrica editorial ainda não entregou rascunhos (coletor e pipeline desligados nesta fase). Nada é simulado." | confirmado |
| 5 | `/studio/cms/correcoes` | coleção | "Nenhum caso registrado" — "Nenhuma errata ou pedido de direito de resposta até agora." | confirmado |
| 6 | `/studio/cms` | coleção | "Nenhuma matéria ainda" — "A fila editorial está vazia. As matérias chegam pela Fábrica editorial ou são criadas aqui. Nada foi simulado." + "Criar a primeira matéria" | confirmado |
| 7 | `/studio/cms/pautas` | coleção | "Nenhuma pauta" — "Nenhuma pauta autoral registrada." + "Nenhuma fonte primária habilitada" — "A pauta autoral precisa de 2 a 8 âncoras em fontes primárias habilitadas. Revise e habilite fontes em Fontes da Fábrica." | confirmado |
| 8 | `/studio/correcoes-titular` | coleção | "Nenhum pedido" — "Nenhum pedido do titular recebido até agora." | confirmado |
| 9 | `/studio/creative` | coleção | "Nenhum card" — "Nenhum card salvo ainda. Gere a prévia de uma matéria e salve o card." | confirmado |
| 10 | `/studio/crm/anunciantes/[id]` | registro | "Anunciante não encontrado." | confirmado |
| 11 | `/studio/crm` | coleção | "Nenhum lead" — "Nenhum lead recebido. Os leads chegam pelo formulário do mídia kit (portal) ou são registrados abaixo." + "Nenhum anunciante" — "Crie o anunciante acima ou converta um lead qualificado em oportunidade." | confirmado |
| 12 | `/studio/decisoes` | coleção | "Nenhuma decisão registrada" — "Nenhum ritual foi executado, então não há atas nem decisões. Nada é simulado." | confirmado |
| 13 | `/studio/entidades` | busca | "Digite um nome para buscar." na entrada; com busca sem resultado: "Nenhuma empresa ou executivo encontrado" — "Nenhum registro para \"…\". Ausência de registro não prova inexistência." | corrigido (antes "Nenhum resultado") |
| 14 | `/studio/finops` | painel | "Ainda não há rota deste módulo no Backend: o que for registrado aqui fica na memória do processo do Studio e some ao reiniciar. Nada é inventado." | não se aplica (painel) |
| 15 | `/studio/fontes/fabrica` | configuração | "115 fonte(s); 0 habilitada(s)" (leitura real; cadastro de configuração, não coleção vazia) | não se aplica |
| 16 | `/studio/fontes` | coleção | "Nenhuma fonte cadastrada" — "O banco de fontes está vazio. Cadastre as fontes oficiais abaixo; a coleta automática depende da Fábrica editorial e está desligada nesta fase." | confirmado |
| 17 | `/studio/home-menus` | configuração | Documentos padrão versionados sempre presentes; mostra o rascunho publicado, sem lista vazia | não se aplica |
| 18 | `/studio/inventario` | painel | Posições do blueprint (9) e catálogo vêm da configuração; com catálogo vazio: "Nenhum formato no catálogo" — "Nenhum formato corresponde a esta seção e disponibilidade. Ajuste os filtros para ver o catálogo." | corrigido (ganhou vazio do catálogo e erro de leitura) |
| 19 | `/studio/midia` | coleção | "Nenhum ativo na biblioteca" — "Registre o primeiro ativo abaixo, com a base de direito." | confirmado |
| 20 | `/studio/modelops` | configuração | "Ainda não há rota deste módulo no Backend: o que for registrado aqui fica na memória do processo do Studio e some ao reiniciar. Nada é inventado." | não se aplica |
| 21 | `/studio/organizacao` | configuração | Configuração versionada (64 perfis); com filtro sem agente: "Nenhum agente neste departamento" — "A configuração versionada não tem agente no departamento escolhido. Ajuste o filtro para ver todos; nada é estimado." | confirmado |
| 22 | `/studio/organogramas` | busca | "Nenhuma empresa encontrada" — "Ausência de registro não prova inexistência." | confirmado |
| 23 | `/studio` | painel | Contagens com fonte e data (0 é leitura real); "Módulos sem backend mostram o que falta: nenhum número aqui é estimado ou fictício." | corrigido ("sem dados" saiu; contagem com erro ganhou nova tentativa) |
| 24 | `/studio/piloto` | coleção | "Piloto ainda não executado" — "Nenhuma matéria do piloto foi ligada a um rascunho. Depois da rodada, o operador do piloto fixa o mapa abaixo, a partir da planilha do AgentOps." | confirmado |
| 25 | `/studio/piloto/violacoes` | coleção | "Nenhuma violação" — "Nenhuma linha do piloto tem parada imediata (o piloto ainda não gerou linhas)." | confirmado |
| 26 | `/studio/reunioes` | configuração | "Ainda não há rota deste módulo no Backend: o que for registrado aqui fica na memória do processo do Studio e some ao reiniciar. Nada é inventado." | não se aplica |
| 27 | `/studio/seo` | coleção | "Nenhum redirecionamento" — "Nenhum redirecionamento cadastrado." | confirmado |
| 28 | `/studio/social` | coleção | "0 pacote(s)" por canal (leitura real), "Nenhum pacote social gerado ainda." na fila e "Métricas indisponíveis. integração de métricas não configurada; sem números fictícios." | confirmado |
| 29 | `/studio/watchlists` | coleção | "Nenhuma watchlist" — "Crie uma lista abaixo para acompanhar empresas e executivos." | confirmado |

### As 4 telas sem coleção

| Rota | Por que o vazio não se aplica | O que mostra |
|---|---|---|
| `/studio/cms/nova` | formulário de criação; não há coleção a esvaziar | campos vazios e o botão de criar; erro volta no próprio formulário |
| `/studio/conta` | formulário de troca de senha | e-mail da sessão e os três campos; erro/sucesso no cartão |
| `/studio/piloto/importar` | formulário de importação | campos de importação; erro volta no próprio formulário |
| `/studio/entrar` | formulário de login (fora do layout protegido) | e-mail, senha e 2º fator; erro no próprio formulário |
