# R0-06 — testemunho dos três casos do verificador autônomo

Autor: LN Verifier Ops. 25/11/2026, ~20:40Z. Só execução local: sem push, sem tag, sem
assinatura, sem publicação.

## Commit e comando

- Verificador: `mzinhoww-svg/loyaltynews-governance-verifier`, commit
  **`a2bfc48da99a6ef249d2e1ef5248bfbdf7fbebd8`** (main), worktree próprio em `%TEMP%` criado
  por `git worktree add --detach ... a2bfc48`.
- Suite: `tests/test_r0_06.py`, rodada da raiz do repo com
  `python -B tests/test_r0_06.py`.
- Resultado: **`Ran 18 tests in 333.092s` — `OK`** (18 de 18). Log completo em
  `r0-preparacao/R0-06/pytest-r006-a2bfc48.log`.

## Ajuste de ambiente (declarado, não muda o teste)

A suite é escrita para Linux. No Windows ela falha antes de testar, porque o `gpg` do MSYS
não assina e o `gpg-agent` não sobe sozinho. Para rodar aqui, sem tocar no código do teste:

- `gpg.program` = `C:/Program Files/GnuPG/bin/gpg.exe` (GnuPG 2.5.24 nativo);
- `MSYS2_ENV_CONV_EXCL=GNUPGHOME` (impede o MSYS de converter o caminho do chaveiro);
- `gpgconf --launch gpg-agent` antes da suite.

Com isso os 18 testes passam. Em Linux o mesmo comando roda sem esses ajustes.

## Os três casos

### 1. Tag criada pelo executor é inválida — **passou**

`test_12_executor_signed_acceptance_is_not_acceptance`: o teste cria `task/R0-01/accepted`
assinada com a chave do **executor** e `Gov(...).accepted('R0-01')` devolve `False`.
Complemento `test_11_forged_review_rejected_nothing_pushed`: o parecer do revisor trocado por
um assinado pelo executor é recusado com `parecer do revisor invalido` e **nada** é empurrado.

### 2. Gate com teste falho não recebe tag — **passou**

`test_09_runner_failed_signs_rejection_with_reason`: com o relatório do runner reprovado, o
assinador sai 2, grava `task/R0-01/rejected/<M>` com motivo `REQUIRED_TESTS_FAILED` e **não
existe** `task/R0-01/accepted`. `test_04_runner_failed_skips_model_call` confirma que o
revisor nem chama o modelo quando o runner falhou.

### 3. Mudança do executor no verificador é barrada — **passou**

O suite não cobre este caso; demonstrei com o código do próprio verificador
(`scripts/premerge.py::root_signed`, `keys/raiz.asc` e `rulesets/verifier-main.json` do commit
`a2bfc48`). Script e saída em `r0-preparacao/R0-06/caso3-mudanca-executor.{py,json}`:

- commit real da main `a2bfc48` assinado pela raiz: **True**;
- commit de mudança assinado por chave que não é a raiz
  (`706A956BC0F583C5339704710E46DAC44E26A553`): **False**;
- ruleset `verifier-main` no commit: `active`, `bypass_actors: []`, regras
  `update`/`deletion`/`non_fast_forward` em `refs/heads/main`.

Nota de saneamento (26/11): o script foi ajustado para não gravar caminho pessoal — a base virou
`<tempdir>/ln-r006` e o GnuPG vem de `GPG_BIN` (padrão `C:\Program Files\GnuPG\bin`). O JSON acima é da
nova execução com esse script; a chave descartável e o SHA do commit de mudança, por serem efêmeros,
mudam a cada execução — o que vale é `ok: true` com a raiz `True` e o executor `False`.

## Limite

- O caso 3 prova a regra (cadeia só aceita assinatura da raiz) e o ruleset que impede
  alteração direta; não simula um push real no GitHub (seria escrita, e o pedido era sem
  push).
- A suite roda com chaves falsas e OpenRouter falso em `127.0.0.1`: nada sai da máquina. O
  custo de LLM é zero.
- O arquivo pronto para o verificador é `casos-verificador.json` (ids exatos da regra
  `r0_06`); basta copiá-lo para `evidencias/R0-06/casos-verificador.json` no commit da
  evidência.
