# Loyalty News 2.1 — pacote reconciliado / MCP local RC1
**Estado:** GO condicional R0; release candidate de governança, sem implantação nem aceite real. Leia `docs/Blueprint_v2_1.md`, `docs/Divergencias_e_achados.md` e `prompts/00_ABERTURA_R0.md` antes de executar. A auditoria autorizou parecer, não execução; o responsável decide abertura de contas/deploy e guarda raiz. Nada no pacote contém credenciais.

## Início local (macOS/Linux ou WSL; Python 3.10+, Git, GnuPG para testes)
1. Extraia o ZIP completo e abra a pasta raiz em Claude Code. Não execute históricos dentro de `originals` ou `audit-output/tools`.
2. `python3 tools/gov.py gov_get_state '{}'` — deve mostrar 88 itens, nenhum aceito, R0-01 como próxima tarefa. Não precisa criar Git para essa leitura.
3. `python3 tests/test_governance.py` — 13 testes normativos e 2 adicionais; chaves descartáveis em `/tmp`, removidas ao término. Necessita `git`, `gpg`, `gpgconf`.
4. `.mcp.json` declara o servidor de projeto `loyalty-governance`; aceite a conexão local na sessão interativa do Claude Code. Consulte `/mcp` e valide a lista de 13 ferramentas. Se `python3` não estiver no PATH, faça alteração protegida de instalação em R0-03; não alterar silenciosamente. Não há URL remota.
5. Dê ao Claude o prompt em `prompts/00_ABERTURA_R0.md`. A primeira etapa pede configuração única de contas/chaves, sem pedir valores em chat. Só use GitHub e Vertra com escopos autorizados. Não marque nenhuma tarefa como aceita manualmente.

O MCP não cria repositório, não instala OpenBot, não conecta LLMs, não lê Vertra diretamente. Orienta e registra propostas. O verificador não está no `.mcp.json`; instalar `verifier-kit` em repositório privado separado administrado pelo responsável, com política confiável e runner externo. A chave raiz e as chaves privadas não pertencem à árvore do projeto. Configure `LOYALTY_PUBLIC_TRUST` no ambiente local como caminho de arquivo de fingerprints públicos pinado externamente (read-only para executor). Importe as **chaves públicas** verificadas no keyring local; sem trust externo nenhum aceite é reconhecido. A confiança final é a conferência externa, não o processo manipulável pelo executor.

## Uso orientado
- `gov_next_tasks`, `gov_get_task`, `gov_get_acceptance_criteria`, `gov_get_dependencies`.
- `gov_start_task` reivindica uma proposta; implemente/teste apenas escopo autorizado.
- Commit dos artefatos e logs saneados primeiro; use `python3 tools/evidence_key.py R0-XX <caminho-artefato>` para hash e chave. Envie `gov_submit_evidence` com lista de caminhos e testes `{id,nome,resultado,registro_sha256}`. Commit separado da evidência. Não inserir campo de aceite/revisão, segredo ou chave.
- Abrir PR via GitHub, não pelo MCP; revisor independente e verificador externo produzem attestations e tags. Atualizar clone/tags e consultar novamente. Sem tag assinada não avance.
- `gov_report_block` para falta de acesso, evidência ou aprovação reservada. Bloqueios/reivindicações órfãs precisam do procedimento externo de liberação, ainda não homologado.

## Arquivos
- `governance/`: requirements, decisions, backlog, findings, identities (sem valores), policy; YAML em sintaxe JSON válida.
- `contracts/`: 64 agentes, 19 workflows, 28 rituais, política de modelos v2.1.
- `docs/`: blueprint, tracker, conformidade, achados/deltas, relatório de testes.
- `tools/`: CLI e MCP stdio, helper de chave de evidência.
- `verifier-kit/`: implementação de referência para ambiente isolado, instruções, exemplos públicos de trust e checks; NÃO instalar com chave de assinatura na máquina do executor.
- `audit-output/`: pacote de auditoria original preservado.
- `originals/`: baseline 1.0, projeto 2.0, dossiê e brandkit originais.
- `prompts/`: abertura e 12 tarefas R0. Os prompts históricos não são aplicáveis.

## Estado real
15 testes locais executados; não confundir com teste de enforcement GitHub, app Claude Code ou Vertra. Sem tag de aceite real. Sem pipeline real, provedor/revisor real, regras GitHub, chaves de produção, budget configurado, licenças, parecer jurídico anexado e sem deploy. F-055 e F-120 continuam abertos. O pacote não afirma estar pronto para autonomia de implantação.
