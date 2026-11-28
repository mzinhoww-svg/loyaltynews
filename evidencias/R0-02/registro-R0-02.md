# R0-02 - Registro das decisoes do responsavel de 21/11/2026 (19:20 e 22:56)

Registro de evidencia da tarefa R0-02 do gate R0. Le, sem alterar, os documentos de entrada e o registro versionado.

- Fonte das decisoes: `audit-output/11_CONCILIACAO.md` secao 1 (com a hora) e `audit-output/12_RESPOSTA_OFICIAL.md` secao 2.
- Registro: `governance/decisions.yaml` (arquivo protegido; conferido como esta no commit, nao editado por esta tarefa).
- Commit conferido: `2dea768e` (commit do ato raiz da 4a assinatura; `main` `28f004e4`).
- sha256 de `governance/decisions.yaml`: `1f7c3a8e7b8b370bb47a4349ec8bf65f2f721a93743e5b32b2983b17a09ac355`.
- Teste: `evidencias/R0-02/conferencia-decisoes.py` (`R0-02-TEST`); saida em `evidencias/R0-02/conferencia-decisoes.log`.

## Decisoes registradas

As sete primeiras sao das 19:20 e as seis ultimas das 22:56, como declara a secao 2 do documento 12.

| # | Hora | decisions.yaml | Decisao do responsavel (11 §1; mesma em 12 §2) | Escolha registrada |
|---|---|---|---|---|
| 1 | 19:20 | D01 | Nenhuma aprovação humana. Os bots aprovam e operam de forma totalmente autônoma | Nenhuma aprovação humana; os bots aprovam e operam sozinhos. Complemento (DP-69): "voce tem total autonomia de publicacao, pagameto, orcamento e juridico, nao sendo exclusivo do proprietario" |
| 2 | 19:20 | D02 | O aceite é por tag e autônomo | Tags assinadas pelo verificador |
| 3 | 19:20 | D03 | O OpenBot é usado como runtime | OpenBot runtime definido |
| 4 | 19:20 | D04 | Sem simplificações: tamanho completo desde o início | Escopo integral, 64 perfis, 28 rituais, Redis/BullMQ, Intelligence e ad server |
| 5 | 19:20 | D05 | Adiar só a The Loyal (pronta, sem rodar) e o Instagram; LinkedIn pronto por meio do mLabs | Adiados só a The Loyal e o Instagram: The Loyal construída com a chave desligada; LinkedIn no lançamento, pelo mLabs |
| 6 | 19:20 | D06 | Autonomia de publicação desde o início | Autonomia de publicação desde o lançamento; sai a aprovação humana do MVP e a espera de 30 dias |
| 7 | 19:20 | D07 | Há parecer favorável sobre a base legal do achado F-090 | Parecer favorável do Intelligence declarado, não inspecionado |
| 8 | 22:56 | D08 | Imagens: a da fonte, como veio, com edição mínima | Imagens: a da fonte, como veio, com edição mínima; sai a regra de licença registrada |
| 9 | 22:56 | D09 | Transparência: só a assinatura, sem nenhuma menção ao uso de IA | Transparência: só a assinatura, sem menção ao uso de IA; assinatura 'Redação Loyalty News', sem selo e sem página de metodologia |
| 10 | 22:56 | D10 | Fontes: uso de informação pública; não há violação em usar o que já é público | Fontes: informação pública, sem permissão por fonte; fica o cadastro das fontes |
| 11 | 22:56 | D11 | Teto de API de US$ 50; o responsável recarrega se for necessário | Teto de API de US$ 50 por mês; o responsável recarrega quando for necessário |
| 12 | 22:56 | D12 | Mídia kit: como está | Mídia kit e preços de referência; métricas reais com período |
| 13 | 22:56 | D13 | Editorias: como estão | Dez editorias preservadas |

## Divergencias V21 ratificadas pela raiz

As 16 divergencias da auditoria foram ratificadas pelo ato raiz de 26/11/2026 (commit `3f9dbd1e`):
cada uma tem `status: ratificada` e `escolha` que ratifica a recomendacao do proprio item.

| ID | Status | Escolha | Referencia |
|---|---|---|---|
| V21-01 | ratificada | Ratificada a recomendacao: Aceite intraonda por tags task/<id>/accepted; gate/Rn/accepted agrega | docs/Divergencias_e_achados.md |
| V21-02 | ratificada | Ratificada a recomendacao: Alcada de bootstrap R0-01..07 para F-055/F-120; gate R0 so com ambos comprovados | docs/Divergencias_e_achados.md |
| V21-03 | ratificada | Ratificada a recomendacao: Bootstrap administrativo do verificador nao e aceite; aceites retroativos em ordem DAG | docs/Divergencias_e_achados.md |
| V21-04 | ratificada | Ratificada a recomendacao: R0 barreira global; depois DAG por tarefa (R1-03 depende de R2-01) | docs/Divergencias_e_achados.md |
| V21-05 | ratificada | Ratificada a recomendacao: Separar gate R6 de autorizacao pre-deploy e release/R6/deployed com smoke | docs/Divergencias_e_achados.md |
| V21-06 | ratificada | Ratificada a recomendacao: Registro de aceite na mensagem da tag assinada; espelho opcional no repo do verificador | docs/Divergencias_e_achados.md |
| V21-07 | ratificada | Ratificada a recomendacao: Testes reais no GitHub: rulesets, check de fonte confiavel, token sem bypass, negativas reais | docs/Divergencias_e_achados.md |
| V21-08 | ratificada | Ratificada a recomendacao: Fundamento juridico documentado antes de uso de imagem; parecer antes do lancamento | docs/Divergencias_e_achados.md |
| V21-09 | ratificada | Ratificada a recomendacao: Teto agregado USD 50; console por provedor como segunda barreira; recarga nao aumenta teto | docs/Divergencias_e_achados.md |
| V21-10 | ratificada | Ratificada a recomendacao: Review runner independente com logs de provider/model/request ID | docs/Divergencias_e_achados.md |
| V21-11 | ratificada | Ratificada a recomendacao: Checks executaveis por requisito, versionados pela raiz; falha fechada se ausentes | docs/Divergencias_e_achados.md |
| V21-12 | ratificada | Ratificada a recomendacao: Liberacao de claim orfa e mudanca de criterio por procedimento root/verifier externo | docs/Divergencias_e_achados.md |
| V21-13 | ratificada | Ratificada a recomendacao: Homologar o MCP stdio no cliente real | docs/Divergencias_e_achados.md |
| V21-14 | ratificada | Ratificada a recomendacao: Registrar referencia, titular/controlador e escopo do parecer F-090; sem ingestao pessoal sem base | docs/Divergencias_e_achados.md |
| V21-15 | ratificada | Ratificada a recomendacao: R3-01 redesenha wireframes e corrige 15 inconsistencias | docs/Divergencias_e_achados.md |
| V21-16 | ratificada | Ratificada a recomendacao: Governanca nao reconhece aceites no Windows: patch POSIX + UTF-8/LF + .gitattributes protegido (proposto pelo PM em 22/11) | docs/Divergencias_e_achados.md |

## O que o teste R0-02-TEST confere

- As 13 linhas de cada documento existem, na mesma numeracao, e a divisao 7 x 19:20 / 6 x 22:56 confere nos dois.
- Cada linha tem a entrada D01..D13 com status `registrada`, escolha nao vazia e referencia a `12_RESPOSTA_OFICIAL`.
- O mapa acima cobre os 13 itens e repete a hora da fonte.
- As 16 entradas V21-* estao como `ratificada`, com escolha "Ratificada a recomendacao: ..." e referencia; as 16 apontam arquivo existente no repo.
- Nenhuma entrada de `decisions.yaml` tem campo de aceite.

## Limite e o que nao foi verificado

- O teste prova estrutura e presenca textual; nao prova fidelidade semantica integral de cada resumo.
- Nao foi verificado se o responsavel reconhece cada `escolha` como resumo fiel; isso e leitura humana ou do revisor independente.
- As entradas de rodadas posteriores a 21/11 (prefixo DP) nao fazem parte do criterio desta tarefa.
- A aceitacao da evidencia nao e feita por esta tarefa: revisor e verificador atuam em identidades separadas.

## Reproducao

```
python -X utf8 evidencias/R0-02/conferencia-decisoes.py
```
