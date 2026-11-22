# 01 · Cobertura da leitura

Auditoria independente pré-T00 · 21/11/2026.

## 1. O que foi recebido e como foi tratado

- Mandato: `3692d9c5-attachment.txt`, idêntico por SHA-256 a `00-instrucoes/PROMPT_AUDITORIA.md` (`f1ec25ca…923f`).
- Dossiê: `Loyalty_News_Dossie_Auditoria_Pre_T00.zip`, SHA-256 `938c9e13601ba435dfb873963e9ac45016009fd867e5e4a163d18b2d95ec9ddd`, com 39 arquivos.
- O conteúdo foi extraído para uma pasta própria, marcada como somente leitura, e tratado como dado: nenhum script, prompt ou HTML do pacote foi executado. Os dois prompts históricos (`implementation_prompt.md` e `T00_prompt.md`) foram lidos como material de auditoria e **não foram executados**.
- Nada foi instalado, provisionado, publicado ou contratado. Nenhuma conta, repositório, DNS ou recurso Vertra foi acessado. Os únicos arquivos criados são os de `audit-output/`, incluído o anexo `audit-output/tools/` com os scripts de conferência.
- Ao final, os 39 arquivos foram conferidos de novo contra os hashes calculados na extração: **nenhum foi alterado**.

## 2. Integridade

| Verificação | Resultado |
|---|---|
| `MANIFEST_SHA256.json` | 38 de 38 entradas conferem (cobre tudo, menos ele mesmo) |
| `01-baseline-1.0/manifest_sha256.json` | 7 de 7 conferem |
| `02-versao-2.0/manifest_sha256.json` | 10 de 11 conferem; `Loyalty_News_v1_0_Baseline.zip` não está na pasta, mas existe com o hash declarado dentro de `05-originais` (F-001) |
| Pacote original aninhado (`05-originais`) | 31 membros lidos em memória; 29 idênticos a arquivos do dossiê; os outros 2 são pacotes dentro do pacote |
| Arquivos do dossiê sem origem no pacote original | Mandato, registro de decisões, README raiz, manifesto raiz e as 5 imagens: esperado, são material novo do dossiê |
| `project_state.json`, campo `baseline_sha256` | Confere com `Loyalty_News_Projeto_v2_0.zip`, que é o pacote da v2.0, não a baseline v1.0 (F-002) |
| PDF "Completos" (82 páginas) | É a concatenação de 25 + 49 + 8 páginas dos outros três PDFs, conferida por hash do texto de cada página |
| Três PDFs trazem um anexo "Content Credentials" | Registrado; não foi extraído |

## 3. Inventário por arquivo

Situações usadas: **Lido** (conteúdo integral, direto ou por saída de script); **Lido por equivalência** (igualdade com texto já lido, provada por comparação); **Lido em parte**; **Inspecionado** ou **Inspecionado em miniatura** (imagens e páginas de PDF); **Verificado por hash** (sem leitura do conteúdo).

| Arquivo | Versão | Bytes | SHA-256 | O que foi lido | Como | Situação |
|---|---|--:|---|---|---|---|
| `00-instrucoes/PROMPT_AUDITORIA.md` | mandato | 10852 | `f1ec25caaa0f62aaed0929457f8f5e87de94b6c71af596aeb307cc99e811923f` | Integral; idêntico por hash ao anexo colado na conversa | leitura direta + hash | Lido |
| `00-instrucoes/REGISTRO_DECISOES.md` | dossiê | 4057 | `162b47480a3fafe7cf55a0e00187166ac8f879b08b2ec97158529a9218dc7b70` | Integral (D01 a D19) | leitura direta | Lido |
| `01-baseline-1.0/README.md` | 1.0 | 263 | `9402ca1e2c236f4504f77effb9880a67ad904a861ff6e53f0cb08ab8e9838d20` | Integral | leitura direta | Lido |
| `01-baseline-1.0/baseline/Loyalty_News_Blueprint.md` | 1.0 | 42060 | `cfbea7071e329022a85bb59215bbd2fbfd60ab76257ecadba3cb707eb93a5587` | 351 linhas, por comparação: difere do v1.1 só na linha 2 (rótulo de versão) | diff contra texto já lido | Lido por equivalência |
| `01-baseline-1.0/baseline/Loyalty_News_Blueprint_v1_1.md` | 1.1 | 56922 | `248e07ea3dc8fb28d0682529d5b21e4334ea62444de50fd37d0aed0e4ef75e69` | 429 linhas, por comparação: byte a byte igual às linhas 179 a 607 do blueprint v2.0, lidas na íntegra | diff vazio | Lido por equivalência |
| `01-baseline-1.0/baseline/Loyalty_News_Social_Growth.md` | 1.1 | 14854 | `407d023be6a911e8fb7a9a2e2b9096aec28adf4d4711f064b5c3f6554add64d7` | 73 linhas, por comparação: iguais às linhas 356 a 428 do v1.1 | diff | Lido por equivalência |
| `01-baseline-1.0/baseline/Loyalty_News_Social_Wireframes.html` | 1.1 | 19957 | `83dd32a3dfce7db2f9fbedc7c92eab9efa617b7290f71797830335ab5c40e30e` | Estrutura (8 seções, sem script) e os primeiros 6.500 caracteres do texto visível, de cerca de 7.500 | extração estática | Lido em parte |
| `01-baseline-1.0/baseline/Loyalty_News_Social_Wireframes.pdf` | 1.1 | 203034 | `a57e4a856ee5ee65e2990ee6ed65a696c1bdb6ca2acf9e664dca0e9d86d4ac37` | 8 de 8 páginas vistas em miniatura (390 px); título de cada página extraído | rasterização + texto | Inspecionado em miniatura |
| `01-baseline-1.0/baseline/Loyalty_News_Wireframes.html` | 1.0 | 192635 | `4c07d84ff10a147c671dc9ec8eb3e3026f2dc5b27ede85a243dee19dee132931` | Aplicativo em JavaScript com 35 telas no objeto `views`, decodificado sem executar. Texto integral de home (em parte), matéria e mídia kit (em parte); cerca de 650 caracteres iniciais das demais 30 telas. Alternância para mobile **não inspecionada** (exigiria executar o script) | extração estática | Lido em parte |
| `01-baseline-1.0/baseline/Loyalty_News_Wireframes_Visual.pdf` | 1.0 | 5677971 | `61ea6bdc0a5fa50466c26f7d92aca3722f358dacee74da465ff47afd386b075b` | 49 de 49 páginas vistas em miniatura (256 px), o suficiente para layout e não para texto pequeno; rótulo de cada página extraído. Só há capturas de desktop | rasterização + texto | Inspecionado em miniatura |
| `01-baseline-1.0/manifest_sha256.json` | 1.0 | 735 | `c15af5c312c551fe1a8451dc51eb10436ece9d8503dfcc80158aa5f4719954e4` | Integral; 7 de 7 conferem | script | Lido |
| `02-versao-2.0/Loyalty_News_Blueprint_v2_0.md` | 2.0 | 93975 | `6048d7d65c6ac949c0b9045dc428ac9c34833d46c903dc7f0c8b2051615e19fe` | Integral, 607 linhas (seções 0 a 18 e apêndice) | leitura direta | Lido |
| `02-versao-2.0/Loyalty_News_Wireframes_Completos_v2_0.pdf` | 2.0 + 1.x | 5921684 | `94e7f5b09e876d5b5aad618d9a18a62a1b70621616d5cdd21aed928f1325cdb8` | 82 páginas = 25 (v2.0) + 49 (visual 1.0) + 8 (social), conferido por hash do texto de cada página; não inspecionado de novo | script | Coberto por equivalência |
| `02-versao-2.0/Loyalty_News_Wireframes_v2_0.html` | 2.0 | 39515 | `e8f39875a68dcf7ce356ac771d8492f23cb1e9bbe11f45cecced13b07a6e87d3` | Texto integral das 25 pranchas; sem script | extração estática | Lido |
| `02-versao-2.0/Loyalty_News_Wireframes_v2_0.pdf` | 2.0 | 133150 | `0898a2384ab2501534a8281ea35d0219153243ca7f1a6cc8e9298d7994e4b760` | 25 de 25 páginas vistas em miniatura (520 px) | rasterização | Inspecionado em miniatura |
| `02-versao-2.0/README.md` | 2.0 | 427 | `f84ddc46aee02cba4f5b247aacf91b2464b93e9af85a6441e3397254c051f99e` | Integral | leitura direta | Lido |
| `02-versao-2.0/contracts/agents.registry.json` | 2.0 | 28902 | `e70955f13e3d5aa4220f35d7c51d0788b76a84e52d0dfd0cfd53109311b04b49` | Integral, 64 registros | script + leitura da saída | Lido |
| `02-versao-2.0/contracts/budget.scenarios.csv` | 2.0 | 2044 | `a7555bf6957c1cfd4e37d287a616fc3891349ae3b516506b5d66b3a14faa8b94` | Integral, 27 linhas; aritmética refeita | script + leitura | Lido |
| `02-versao-2.0/contracts/implementation_prompt.md` | 2.0 | 1432 | `06e047699e7a16a4019d06ec2edc3e4522b30fc96a5caa0504bcbf036179ad55` | Integral, como material de auditoria. **Não executado** | leitura direta | Lido |
| `02-versao-2.0/contracts/meetings.registry.json` | 2.0 | 21060 | `fe021fb8c8be41c6f405374d030e15e2586ebb854beaf0ffbedb6f8a09864322` | Integral, 28 registros; contagem conferida com a tabela da seção 3 do blueprint | script + leitura da saída | Lido |
| `02-versao-2.0/contracts/model.policy.json` | 2.0 | 3113 | `3ac3820cd4dfb08c8780bbbc4106bddec766ba0f8df3d025c2f07eacf798eeb8` | Integral | leitura direta | Lido |
| `02-versao-2.0/contracts/workflows.registry.json` | 2.0 | 6371 | `1df7be3ac51407291982136bbf7b5b213d3b7396fdf48ddc9f970fadd153cfcb` | Integral, 17 registros; comparado campo a campo com a seção 7 do blueprint (0 divergências) | script + leitura da saída | Lido |
| `02-versao-2.0/manifest_sha256.json` | 2.0 | 1169 | `f2d0173c6b9517bd8c8767d64e3188c4d5930131045c029f634ce09bc6614399` | Integral; 10 de 11 conferem, 1 arquivo ausente da pasta | script | Lido |
| `03-implantacao/Loyalty_News_Plano_Implantacao_2_0.md` | plano | 25048 | `0c38f236ebe9befeedb69dc729eec504ee7dc75e7b2364f6136e4f989f36e93a` | Integral, 238 linhas | leitura direta | Lido |
| `03-implantacao/Loyalty_News_Tracker_Implantacao.xlsx` | plano | 17446 | `31a794d5801911fdaa65c82782996006f5a9c44797cc3eee0f75c866704a47f6` | 4 abas; Tranches, Tarefas e Acessos idênticas aos CSV; 10 fórmulas na aba Controle | extração + comparação por script | Lido |
| `03-implantacao/deployment/T00_prompt.md` | plano | 985 | `c9ecf36ed1ad20b2551d7af450d4afc8b62454d0a8d89c66fb6679f42545ca60` | Integral, como material de auditoria. **Não executado** | leitura direta | Lido |
| `03-implantacao/deployment/acessos.csv` | plano | 1755 | `20388a126a62afbc306149bd88cd1f2b743458daab14cf2df35f7929c1c547d1` | Integral, 15 linhas | leitura direta | Lido |
| `03-implantacao/deployment/evidence.schema.json` | plano | 1482 | `3869d1f67e0cda79aba0e27c28a44523084508948253a5d8d3556e1482990fd5` | Integral | leitura direta | Lido |
| `03-implantacao/deployment/project_state.json` | plano | 2927 | `fc6ea2d27f1aa1f86c36b6d5118fe0efacf6e907c43c6f78ed91a000062a1004` | Integral | leitura direta | Lido |
| `03-implantacao/deployment/tarefas.csv` | plano | 9220 | `392a7765466491fc780202a10c182d8469d7209c88439f857135b4ffe1d93db7` | Integral, 58 linhas | leitura direta + script | Lido |
| `03-implantacao/deployment/tranches.csv` | plano | 2830 | `84f28acbc5f570cb606982409643b969b8b5ff056fc56a39b7836345c4466a00` | Integral, 12 linhas | leitura direta + script | Lido |
| `04-referencias/IMG_0968.jpeg` | referência | 226327 | `33ac0e891d2a72356251ebc2ab7e72e3a8a3da516df61c7fe793ee9f0c840165` | Imagem inteira, reduzida a 510 px de largura | inspeção visual | Inspecionado |
| `04-referencias/IMG_0969.png` | referência | 470662 | `cdd72e58e895f8cb29c3f776328175d961a336c54e8d80c6627ecb21b85670ea` | Idem | inspeção visual | Inspecionado |
| `04-referencias/IMG_0970.jpeg` | referência | 207384 | `be0b90bc0d582b79e895ca0b27d7c7fa728f144877a8f9eaf6f289304395b78b` | Idem | inspeção visual | Inspecionado |
| `04-referencias/IMG_0971.jpeg` | referência | 330375 | `d6a7f56d5df45bd8fa23dee2f0515a1d5ba0af354920838914fe696842b1c34e` | Idem | inspeção visual | Inspecionado |
| `04-referencias/IMG_0972.jpeg` | referência | 282786 | `354f8907bfde02eb3f0a2b9735dd91c3ec8f7ef6b3936cb15774299bf8e2111e` | Idem | inspeção visual | Inspecionado |
| `05-originais/Loyalty_News_Deployment_Pack_2_0.zip` | originais | 10569577 | `2e0d7fda11498fd75d3d96533a9982f47054d608133cd019cc9d550cfef7a181` | Não extraído em disco. 31 membros lidos em memória: 29 idênticos por hash a arquivos do dossiê; os outros 2 são os próprios pacotes aninhados | script | Verificado por hash |
| `MANIFEST_SHA256.json` | dossiê | 4394 | `346dfaffaeb56a3d580f2c2db75978d14bca1aceed90a95be89295b965b7c0d2` | Integral; 38 de 38 entradas conferem | script | Lido |
| `README.md` | dossiê | 2304 | `352e5363809181c55d23769104bc8fcaa21c98c927e600bcd5aa1169b4a12920` | Integral | leitura direta | Lido |

Resumo: 24 lidos na íntegra, 3 lidos por equivalência, 2 lidos em parte, 5 imagens inspecionadas, 3 PDFs inspecionados em miniatura, 1 PDF coberto por equivalência e 1 pacote verificado por hash.

## 4. O que não foi inspecionado

| Item | Motivo | Efeito sobre as conclusões |
|---|---|---|
| Variante mobile do protótipo HTML da baseline | Só aparece executando o script do arquivo, o que não foi feito | Não há afirmação nesta auditoria sobre a qualidade do layout mobile da baseline; só se afirma que os PDFs não a mostram |
| Texto pequeno das 49 páginas do PDF visual e das 25 do PDF v2.0 | Vistos em miniatura | Coberto pela leitura do texto de origem em HTML |
| Trechos finais de 30 telas do HTML da baseline e os últimos mil caracteres do HTML social | Leitura parcial | As telas repetem cabeçalho, rodapé e cartões de exemplo; o conteúdo normativo está no blueprint, lido na íntegra |
| Anexos "Content Credentials" dos PDFs | Fora do escopo | Nenhum |
| Qualquer ambiente real (Vertra, GitHub, provedores, redes sociais, GA4) | Vedado pelo mandato | Tudo o que depende de ambiente está marcado como não verificado, com teste proposto |

## 5. Contagens e referências cruzadas conferidas por script

`tools/checks.py`, reexecutável sobre o dossiê.

| Item declarado | Resultado |
|---|---|
| 64 funções | 64 registros, ids únicos, uma raiz (`publisher`), sem ciclos, todos desativados |
| 17 workflows | WF01 a WF17; os 17 conferem campo a campo com a seção 7 do blueprint |
| 28 modelos de reunião | 28: 18 diárias, 6 semanais, 3 mensais, 1 extraordinária; a tabela da seção 3 do blueprint tem 28 linhas |
| 12 tranches e 58 tarefas | 12 e 58; dependências e semanas iguais em `tranches.csv`, no plano e em `project_state.json`; planilha igual aos CSV |
| 47 formatos comerciais | 47 em 9 famílias, mais 8 linhas de pacote (7 pacotes e "customizado") |
| Orçamento | 27 linhas, aritmética correta |

## 6. Inconsistências entre documentos, com referência

| # | Inconsistência | Onde | Achado |
|---|---|---|---|
| 1 | Entrada de manifesto sem arquivo na pasta | `02-versao-2.0/manifest_sha256.json` | F-001 |
| 2 | "Baseline" é a v1.0 no dossiê e o pacote da v2.0 no estado do projeto | `project_state.json` × README × tarefa T00-01 | F-002 |
| 3 | Pilha com Supabase no blueprint e nas pranchas; sem Supabase no plano | Blueprint §8 linha 124; pranchas 20 e 25 da v2.0 × plano §1 linha 5 × registro D10 | F-003 |
| 4 | "Proposta homologável" × "nenhuma tranche homologada" | Blueprint linha 2 × registro D19 | F-004 |
| 5 | Rota "por tarefa, não por cargo" × rota padrão por agente | Blueprint linha 82 e prancha 10 × `agents.registry.json` | F-020 |
| 6 | "Modelos separados para geração e verificação" × redator e checador no mesmo provedor | Blueprint linha 290 × rotas de `model.policy.json` | F-066 |
| 7 | 56 contribuições diárias no orçamento × 77 participações no registro de reuniões | `budget.scenarios.csv` × `meetings.registry.json` | F-031 |
| 8 | Prancha da diretoria editorial mostra 8 das 10 redações | Prancha 4 da v2.0 × blueprint §2.1 | F-006 |
| 9 | WF12 "Conselho de pauta" não corresponde a nenhuma das duas reuniões semanais de nome parecido | `workflows.registry.json` WF12 × reuniões `W-pautas` e `W-cross` | F-032 |
| 10 | Sincronização de diretorias inclui Trust antes da daily de Trust | `meetings.registry.json`: `D-sync` 07:00 × `D-trust` 07:15 | F-032 |
| 11 | Tranches começam antes do fim de dependências rígidas | `tranches.csv` (9 de 20 pares) | F-110 |
| 12 | T11 exige 30 dias após o lançamento e termina 3 semanas depois | `tranches.csv` T11 × plano §2 linha 14 | F-111 |
| 13 | `commit_sha` obrigatório na evidência de T00, cuja tarefa T00-02 é criar o repositório | `evidence.schema.json` × `tarefas.csv` | F-120 |
| 14 | O plano afirma que não havia conector Vertra na sessão em que foi escrito; na sessão desta auditoria há um, com ferramentas de escrita, que não foi usado | Plano §8 linha 226 | F-055 |
| 15 | Pedido original do dono sobre IA e imagens × formulação do registro e do blueprint | Primeira mensagem desta conversa × registro D03 × blueprint linhas 100, 288, 296, 299 | F-071, F-073 |

## 7. Informação ausente do pacote

Declarada como ausente pelo próprio dossiê: anexo editorial de taxonomia; credenciais, licenças, domínio, plano Vertra, repositório, responsáveis e orçamento final (registro D18); código de produção; dados reais de audiência.

Ausente e não declarada: quantas pessoas e horas existem para executar; pessoa jurídica e responsável legal; qualquer pesquisa de audiência ou de concorrência; parecer jurídico; busca de marca; preço da licença comercial do OpenBot; cotação de provedor de e-mail, backup externo e licenças de imagem.
