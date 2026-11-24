# Job agendado de releitura das páginas oficiais (detecção de Moves por duas leituras)

Código: `packages/intelligence/src/reread.ts` (lógica e regras, testada), `src/readers/direct-page.ts` (leitura direta com robots; provedor só como reserva), `apps/workers/src/intelligence-reread.ts` (agendamento no worker; ligado em `apps/workers/src/main.ts`). Testes: `src/tests/reread.test.ts`, `apps/workers/src/intelligence-reread.test.ts`.

## Desligado por padrão (três travas)
O worker só agenda o job se **todas** valerem; qualquer falta é registrada em log e nada é lido nem gravado:
1. `LN_INTELLIGENCE_REREAD=on` (chave operacional deste job);
2. a flag `intelligencePessoas` (J-01) **pelo resolvedor de flags do app** (ADR-022: `startIntelligenceReread({ flags })`, ex.: `(f) => isEnabled(f, runtimeFlags())`). **Nenhuma flag de produto é lida de variável de ambiente própria**; sem resolvedor, toda flag está desligada (hoje `main.ts` ainda não passa o resolvedor: o Backend o liga quando o ADR-022 entrar);
3. `LN_REREAD_SEED=<caminho do seed.public.v5/v7.json>` (conjunto de cargos que o job relê; validado pelo mesmo `validateSeed`).
Opcional: `LN_REREAD_INTERVAL_HOURS` (padrão 168 = semanal por página; piso 24).
**Reserva por provedor** (só quando a leitura direta recusa): Bright Data do staging (DP-36: uma conta `conta-2`, `BRIGHTDATA_API_KEY`, teto 5000, zone `web_unlocker1`, sem troca de conta), ligada **só pela flag `leitorViaProvedor`** (ADR-022, adendo 2; consultada a cada leitura; sem flag, nenhum `fetch` ao provedor). Código: `createReaderViaFlag`/`createBrightDataStagingReader` em `src/readers/flagged.ts`; testes em `src/tests/reader-flag.test.ts`. O valor da chave vem do ambiente do app, nunca do repositório.

## O que faz em cada ciclo (a cada 6 h; só as páginas vencidas, no máximo 5 por ciclo)
1. A página só é relida se a última validação dos cargos dela (no banco) for mais velha que o intervalo. Não há tabela de estado nova.
2. Lê a página pública: direto (robots RFC 9309, redirecionamento não seguido, desafio nunca contornado, pausa entre requisições); só se recusar, o provedor. Texto **efêmero**: só se grava nome+cargo, fonte, link, data e hash.
3. **Página suspeita** (falha, texto < 800 caracteres, outro host, menos da metade das citações conhecidas): nenhuma alteração.
4. Citação conhecida ainda na página → leitura `present` (revalida; sem Move).
5. Citação que **sumiu**: **ausência não é saída** → vai para "revisão" no relatório. Única exceção: **cargo único** (Diretor-Presidente/CEO/Presidente, na forma "Nome<separador>Cargo") cujo cargo continua na página com **outro nome válido** → leitura `left` do antigo + `present` do novo, pelo contrato `role-observation/1`: nasce um Move `departure` **detected** (nada vai ao portal sem revisão humana) e o novo entra como linha de base (primeira leitura de uma pessoa não é Move).
6. Fonte secundária nunca entra aqui; cargo do Conselho não é cargo único (nunca vira troca automática).
Relatório do ciclo (log): contagens por estado (alteradas, para revisar, suspeitas, falhas) e total de Moves; sem texto de página, sem segredo.

## Limites (honestos)
- Detecta **troca do titular de cargo único** e **cita para revisão** o resto. Mudança de vice/diretor (sem cargo único) não vira Move sozinha: precisa de revisão ou de anúncio em comunicado (contrato `role-observation/1` com `announcement`), que é coleta do Editorial.
- A detecção do nome novo é heurística (palavras com inicial maiúscula logo antes do cargo, mesmo separador da citação conhecida); falsa leitura gera, no pior caso, um Move `detected` que o revisor rejeita — e uma pessoa nova na base. Por isso o revisor vê o Move com antes/depois antes de qualquer publicação.
- Pessoa suprimida a pedido do titular nunca é recriada.
- Páginas que só renderizam com JavaScript ou recusam leitura direta dependem do provedor (cota gratuita limitada); sem chave, ficam como "falha" no relatório.
- Não testado contra as páginas ao vivo em ciclo agendado (testes usam páginas sintéticas com as citações reais do conjunto); não rodou em Redis/PostgreSQL de staging.
