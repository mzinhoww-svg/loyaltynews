# Termos das 6 fontes do conjunto verificável — o que as páginas permitem sobre reuso do trecho (J-14)

Para o proprietário decidir. **Não é parecer jurídico.** Lido em 23/11/2026 (robots.txt conferido antes de cada página; uma requisição por URL). Cada passagem abaixo foi **verificada por citação literal** na página indicada (`data/terms.review.v1.json` + `terms.review.v1.verification.json`; teste `src/tests/terms-review.test.ts`). Dotz (página inicial) foi lida pelo navegador do OpenBot, com sha256 conferido.

## Resumo em uma linha
**Nenhuma das 6 fontes autoriza expressamente o reuso de trechos**; nenhuma proíbe expressamente a citação curta com fonte **nas páginas lidas**; 2 têm cláusulas de proibição de reprodução/uso comercial em documentos de **outro escopo** (aplicativos), o que exige cautela. A mitigação já está no código: a exibição pública traz **fato + fonte + link + data**, nunca o trecho literal (que fica só como evidência interna, ≤ 500 caracteres).

## Decisão registrada: DP-28 (proprietário, 23/11/2026)
Texto (`r0-preparacao/decisoes-proprietario-2026-11-22.md`, linha da DP-28): o proprietário autoriza incluir as fontes de mercado (programas, milhas, bancos, varejo, viagem, CRM) **com risco aceito por ele**, "citando e linkando a fonte (sem reproduzir texto/imagem além do necessário)"; mantêm-se robots respeitado, nada de contornar 403/429, fontes com proibição expressa de automação/reprodução (**classe C** do dossiê do Editorial) só com revisão caso a caso, e a exibição de dados de empresas segue **"fato+fonte+link+data, nunca o trecho"**.

Efeito neste documento:
- **As 6 fontes do seed.public.v2 (Livelo, Bradesco, LATAM Pass, ABEMF, ABEMF-associados, Dotz) são fontes de mercado e estão cobertas pela DP-28.** Nenhuma delas é classe C (a lista de classe C citada pela DP-28: Azul, GOL, ABECS, IATA, Nubank, Accor, Marriott, Salesforce, HubSpot, Zendesk, oneworld, ABAV). Atenção: **Azul e Smiles/GOL aparecem no seed só como associadas na página da ABEMF**; nenhuma página da Azul ou da GOL foi lida nem é fonte de registro. Qualquer carga futura que use página dessas empresas como fonte exige a revisão caso a caso da classe C.
- A decisão (a) da seção abaixo **fica resolvida na prática**: a DP-28 mantém "nunca o trecho" para dados de empresas, que é exatamente a regra já implementada e testada. A decisão (b) (exibir trecho literal) **não foi pedida** e continua exigindo autorização por fonte; (c) segue com o jurídico se o proprietário quiser reduzir risco além do que aceitou.
- Risco aceito pelo proprietário não muda o que cada página diz: os achados de Dotz e Bradesco continuam registrados como cláusulas restritivas de outro escopo, e a prudência "fato + link, sem trecho" permanece.

## O que o produto reusa (e o que não)
- **Fato**: "A é associada da ABEMF", "Livelo e Stix têm parceria", "Dotz acumula em cartões do Banco do Brasil e Banco BV". Fatos e ideias não são objeto de direito autoral (Lei 9.610/98, art. 8º, I — a confirmar com jurídico).
- **Trecho curto**: guardado na evidência (citação literal; as 21 citações distintas do seed têm no máximo 115 caracteres, e com o contexto da lista da ABEMF a evidência tem no máximo 141) para provar a origem. **Não é exibido** no portal nem nos handlers públicos: teste `terms-review.test.ts` garante que nenhuma citação literal sai nas respostas públicas (portal e handlers `public`) nem nos handlers do Studio testados (empresa, Moves, grafo).
- **Marca, logotipo, imagem, layout**: **não** reusados (D08: sem imagem de terceiros sem base de direito).
- A citação de pequenos trechos com indicação da fonte tem amparo geral na LDA (art. 46, III e VIII), com limites; **confirmar com jurídico** se algum dia o trecho for exibido.

## Por fonte
| Fonte (página usada) | O que a página diz (literal, verificado) | Autoriza reuso do trecho? | Proíbe? | Leitura prudente / recomendação |
|---|---|---|---|---|
| **Livelo** — `livelo.com.br/imprensa` | Rodapé: "Livelo S.A. Todos os direitos reservados". | Não expressamente. | Não expressamente (termos gerais do site não localizados em texto: existem "Termos e Condições Gerais" em PDF, **não lidos**). | Reserva geral de direitos. Usar só fato + link + data. Se quiser exibir o trecho: pedir autorização à Livelo (assessoria de imprensa). Já é fonte de imprensa pensada para divulgação (as manchetes são da própria Livelo) — risco **baixo** para fato + link. |
| **Bradesco** — `banco.bradesco/cartoes/hotsitefidelidade/` | A página lida **não traz aviso de direitos**. Os "Termos e Condições" do **aplicativo** (outro escopo): "sendo proibida sua reprodução, exceto para uso pessoal e com autorização por escrito do Bradesco". | Não. | Só no escopo do **aplicativo**; para o hotsite, **não localizado**. | Não presumir que a regra do aplicativo vale para o hotsite, mas tratar como sinal de política restritiva. Fato + link; **não exibir o trecho**. Risco **baixo-médio**. |
| **LATAM Pass** — `latampass.latam.com/br/pt/conheca-latampass` | Rodapé: "© 2026 LATAM Airlines Brasil. Todos os direitos reservados." A página "Termos e Condições" lida (HTML) não tem cláusula de reuso de conteúdo; os regulamentos completos podem estar em documentos **não lidos**. | Não expressamente. | Não expressamente (no que foi lido). | Reserva geral. Fato + link. Risco **baixo**. |
| **ABEMF** — `web.abemf.com.br/` (home) | Rodapé: "© 2026 ABEMF - Associação Brasileira das Empresas do Mercado de Fidelização Todos os direitos reservados". Página de termos de uso: **não localizada**. | Não expressamente. | Não expressamente. | Reserva geral. A lista de associadas é divulgada pela própria associação para o mercado. Fato + link; risco **baixo**. Opcional: o proprietário pode pedir um "de acordo" à ABEMF (e-mail institucional da página; **eu não envio mensagens a pessoas**). |
| **ABEMF** — `web.abemf.com.br/associados/` (lista "Empresas Associadas") | Mesmo rodapé de direitos reservados. | Não expressamente. | Não expressamente. | Igual à linha acima. É a fonte de **12 das 20 relações**; se o proprietário quiser reduzir risco com uma única autorização, esta é a mais valiosa. |
| **Dotz** — `dotz.com.br/home` (capturada pelo navegador) | Rodapé: "© Copyright 2026 - DOTZ - CNPJ 10.221.279/0001-97". Termos da **Conta Dotz** (aplicativo/conta, outro escopo): "reprodução, cópia ou quaisquer outras formas de utilização comercial de tal conteúdo pelo usuário são rigorosamente proibidas". | Não. | Sim, no escopo do **aplicativo/conta** e para uso comercial "pelo usuário"; para o site, **não localizado**. | A cláusula é de outro documento, mas é a mais restritiva. Veículo de notícia que cita fato não é "usuário" da conta, porém **prudência**: fato + link, **sem exibir o trecho**; se o proprietário quiser exibir qualquer trecho do Dotz, pedir autorização. Risco **médio**. |

## O que não foi lido (limites desta revisão)
- PDFs de termos (Livelo "Termos e Condições Gerais", regulamentos da LATAM Pass): não há leitor de PDF no verificador; não afirmo o que dizem.
- Termos de uso do **site** da Livelo, do hotsite da Bradesco, da ABEMF e do site da Dotz: **não localizados** nas páginas lidas (ausência na leitura de 23/11/2026, não prova de inexistência).
- Mudanças posteriores nas páginas. Reler antes de ampliar o uso.
- Qualquer contrato ou autorização privada entre a Loyalty News e essas empresas (nenhum conhecido).

## Decisões que cabem ao proprietário (J-14)
1. **Manter a regra atual** — exibição pública só com fato + fonte + link + data, trecho só como evidência interna. *(Recomendado; já implementado e testado.)*
2. Se quiser **exibir trechos literais** no portal: pedir autorização por escrito a cada fonte (começar pela ABEMF e pela Livelo, que divulgam para o mercado) antes de ligar essa exibição; **Dotz e Bradesco: só com autorização**.
3. Decidir se quer pedir "de acordo" à ABEMF para a lista de associadas (maior ganho de cobertura por uma única autorização).
4. Mandar o jurídico confirmar os artigos citados (Lei 9.610/98, arts. 8º e 46) para o caso de uso em veículo comercial.

## Como reverificar
`node packages/intelligence/scripts/verify-dataset.mjs packages/intelligence/data/terms.review.v1.json` (busca cada página uma vez, respeita robots.txt; a fonte `dotz-home` usa a captura `data/captures/dotz-home.json`, sem rede).

## Adendo (v3): fontes novas desde a revisão de 23/11
O seed.public.v3 acrescenta duas fontes: o site da **Esfera** (`esfera.com.vc`, título da página) e o **RI do Santander** (`www.santander.com.br/ri/`, destino do redirecionamento de `ri.santander.com.br`). Os **termos dessas duas páginas não foram lidos** nesta revisão (J-14 caso a caso): valem a DP-28 (fonte de mercado, risco aceito pelo proprietário) e a regra "fato + fonte + link + data, nunca o trecho". A Stix **não** é fonte do conjunto (as relações dela vêm de páginas da ABEMF e da Livelo, já cobertas acima).
