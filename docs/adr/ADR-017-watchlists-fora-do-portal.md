# ADR-017 — Watchlists e alertas ficam no Studio; o portal público não os lê

Estado: **Decidida** (decisão do PM de 26/11/2026, item D do contrato de Intelligence; implementação em ft/portal-p2-1125). Autor: LN Frontend Engineer 2. Revisão: LN Independent QA.

**Revisa:** nova (fecha a pergunta aberta em `fast-track/decisoes/contrato-publico-intelligence-pessoas-moves.md`, seção "Watchlists")
**Achados:** D07 (watchlists no escopo do produto), J-01 (dado pessoal atrás de chave)

## Contexto
Watchlist é uma lista privada: `owner_ref` é a identidade de quem a criou e quem não é o dono recebe **404**, para a lista não revelar que existe (`packages/intelligence/WATCHLISTS_API.md`, "Dono"). Alertas nascem dessas listas e a revisão é só do dono. O portal público não tem login nem sessão; portanto não tem como identificar dono, e qualquer rota pública de watchlist só poderia (a) expor lista de outra pessoa ou (b) devolver vazio sem significado.

O Blueprint põe watchlists no escopo do produto, mas não no portal público. O portal já declara isso ao leitor em `/intelligence`: "Watchlist e alertas personalizados exigem conta e estão desligados nesta fase" (`apps/web/app/(portal)/intelligence/page.tsx`).

## Decisão
1. O **portal público não lê watchlist nem alerta**. Não existe rota em `/api/intelligence/**` para watchlist, item de watchlist ou alerta; a única superfície é `/api/studio/intelligence/**`, autenticada (`auth: 'studio'`) e com RBAC (`entidades:read|create|update`).
2. A leitura continua **privada por dono**: o `actor` vem da sessão do Studio, nunca de parâmetro do cliente, e `owner_ref` não sai em resposta pública alguma.
3. O portal apenas **informa a indisponibilidade** (texto de `/intelligence`), sem prometer data e sem simular lista vazia. Watchlist vazia não é estado do portal: é tela do Studio.
4. Moves e perfil de pessoa/empresa **não** carregam "está na sua watchlist" no portal. Esse selo é do Studio, onde a sessão existe.
5. Ligar watchlists no portal no futuro exige **nova decisão** (login público, dono, retenção e revisão de alerta), não é só expor a rota do Studio.

## Alternativas consideradas
- **Rota pública somente-leitura com token opaco**: ainda precisa de identidade e de um dono; sem login o token é a credencial, e vazá-lo entrega a lista inteira. Recusada.
- **Rota pública que devolve vazio**: transforma "não existe para você" em "não há nada", o mesmo defeito de texto que já corrigimos em Moves. Recusada.
- **Conta de leitor no portal já nesta fase**: fora do escopo do lançamento e das flags atuais. Recusada.

## Consequências
- O Backend mantém as rotas de watchlist/alerta sob `/api/studio/intelligence`; a guarda de teste reprova se alguma aparecer em `/api/intelligence`.
- A navegação do portal não tem item de watchlist; o sitemap e a busca não ganham essa página.
- Quem quiser a funcionalidade usa o Studio, com sessão e MFA.
- Custo aceito: o leitor do portal vê o texto de indisponibilidade em vez de uma lista vazia.

## Critério verificável
- Teste `apps/web/app/api/intelligence/watchlists-fora-do-portal.test.ts`: nenhuma rota pública (`/api/intelligence/**`) contém `watchlists` ou `alerts`; toda rota dessas é `/api/studio/intelligence/**` com `auth: 'studio'`. Controle negativo: acrescentar uma rota pública de watchlist reprova o teste.
- O teste do contrato de watchlists (`packages/intelligence/src/tests/watchlists-contract.test.ts`) continua provando o 404 para quem não é o dono.
- `/intelligence` renderiza o texto de indisponibilidade; nenhuma página do portal busca watchlist.

## Mudança protegida necessária
Não.

## Não verificado
Volume de alertas por dono (paginação acima de 200 não implementada no pacote) e a tela do Studio com dados reais; ambos fora desta decisão.
