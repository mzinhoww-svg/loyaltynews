# R0-04: contagens, tags históricas e teste (evidência)
Preparado por Security & Governance em 23/11/2026, sobre o plano do DevOps (`conferencia-hashes-v2.md`) e a cerimônia R0-04 executada pelo PM.

## Critério de aceite: contagens 64/17/28/12/58/47
| Contagem | Fonte | Valor | Como foi conferido |
|---|---|---:|---|
| 64 funções/agentes | `spec-v2.0/contracts/agents.registry.json` (tag `v2.0`) | 64 | `check_r0-R0-04.txt` e `saida-verifica-hashes.txt` |
| 17 workflows | `spec-v2.0/contracts/workflows.registry.json` | 17 | idem |
| 28 rituais/reuniões | `spec-v2.0/contracts/meetings.registry.json` | 28 | idem |
| 12 tranches | dossiê, `03-implantacao/deployment/tranches.csv` | 12 | `saida-verifica-hashes.txt` |
| 58 tarefas | dossiê, `03-implantacao/deployment/tarefas.csv` | 58 | `saida-verifica-hashes.txt` |
| 47 formatos comerciais | `spec-v2.0/Loyalty_News_Blueprint_v2_0.md`, seção 4 "Mídia kit dinâmico e monetização" | 47 | contagem das linhas de oferta das tabelas abaixo, sem os pacotes |

### Os 47 formatos (seção 4 do Blueprint v2.0, tag `v2.0`)
| Categoria (subseção) | Qtde | Formatos |
|---|---:|---|
| Banners | 8 | Banner topo; Retângulo sidebar; Banner rodapé; Banner dentro do artigo; Banner entre seções da home; Patrocínio Loyalty Market Data; Banner na agenda; Takeover do portal |
| The Loyal | 6 | Banner topo da newsletter; Banner meio; Banner rodapé; Bloco patrocinado; Edição dedicada; Patrocínio boletim de indicadores |
| Conteúdo patrocinado | 6 | Matéria publicitária; Série de matérias; Matéria com retargeting; Artigo de opinião assinado; Página especial patrocinada; Estudo ou e-book |
| Redes e canais | 4 | Post LinkedIn; Carrossel Instagram; Envio WhatsApp; Nota na newsletter |
| Entrevistas | 4 | Entrevista escrita; Entrevista em vídeo; Perfil de empresa; Série trimestral |
| Loyalty Talks | 4 | Patrocínio de episódio; Convidado no podcast; Temporada patrocinada; Cortes de podcast |
| Eventos | 7 | Divulgação na agenda; Destaque agenda home; Cota master; Cota ouro; Cota prata; Webinar ou live; Café ou mesa-redonda |
| Cobertura de eventos | 4 | Matéria de cobertura; Cobertura completa; Cobertura ao vivo; Mediação |
| Impulsionamento | 4 | LinkedIn; Instagram; Retargeting; E-mail marketing dedicado |
| **Total** | **47** | |

A subseção "Pacotes e combinações" tem mais 8 linhas (Presença no mercado, Construir reputação, Liderar uma editoria, Lançamento de programa, Evento completo, Autoridade, Presença anual, Customizado). Elas **não** entram na conta, porque são combinações dos formatos acima: as próprias entregas citam "sidebar + rodapé + LinkedIn" e semelhantes. Com elas, o total seria 55. A afirmação "47 formatos comerciais de referência" do parágrafo inicial do Blueprint bate com os 47 formatos individuais.

## Tags históricas (não são tags de aceite)
| Tag | Objeto da tag | Commit | Conteúdo | Assinatura |
|---|---|---|---|---|
| `v1.0` | `81868425e2c49fabf8a257eb61988af6e60d2ac0` | `4fc096bb322d576d91dbdc3a876a96cec228a187` | `baseline-v1.0/` = `Loyalty_News_v1_0_Baseline.zip` (sha256 `8a7d0d6f…4f77`) | anotada, assinada pela raiz `1D4A3E26…4309` |
| `v2.0` | `7288ad9372032952ee93bcfefd6ef92a63640371` | `0763b030800e9faf9eae07dcb2bf77cd7fa88ac9` | `spec-v2.0/` = `Loyalty_News_Projeto_v2_0.zip` (sha256 `36085264…f931`) | anotada, assinada pela raiz |

As duas são alcançáveis a partir da `main` e estão protegidas pelos rulesets `tags-baseline`/`tags-other`: ninguém move nem apaga, sem bypass.

## Teste R0-04-TEST: "Script reproduz 38/38, 7/7 e 10/11 com a exceção anotada"
- `saida-verifica-hashes.txt` (`verifica_hashes.py`, sha256 `89973c12…2779`, sobre os ZIPs originais):
  - dossiê `MANIFEST_SHA256.json` **38/38**;
  - `01-baseline-1.0` **7/7**;
  - `02-versao-2.0` **10/11**;
  - ZIP v1.0 7/7 e ZIP v2.0 11/11;
  - contagens 64/17/28/12/58.
- **Exceção anotada (F-001):** no `02-versao-2.0` do dossiê falta o `Loyalty_News_v1_0_Baseline.zip` ("AUSENTE"). O ZIP da v1.0 é conferido à parte (7/7), e a tag `v2.0` contém a v1.0 intacta (`check_r0`: "v1.0 intacta dentro da arvore da v2.0").
- `saida-verifica-commits-tags.txt` (`verifica_commits.py`, sha256 `d5503713…de03`), por **blob** contra as tags publicadas, com `--main origin/main --require-annotated --verify-signature --expect-*`:
  - v1.0 7/7;
  - v1.0 dentro da v2.0 7/7;
  - v2.0 11/11;
  - nada fora do layout;
  - tags anotadas e `git verify-tag` OK;
  - "TUDO CONFERE".
- `check_r0-R0-04.txt`: o próprio check do verificador (`checks/scripts/check_r0.py R0-04`, sha256 `656926dd…b08e`, da árvore do verificador) dá "RESULTADO R0-04: ok", com 12/12 itens.
