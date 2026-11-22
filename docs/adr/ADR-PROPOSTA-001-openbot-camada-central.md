# ADR-PROPOSTA-001 — OpenBot como camada central de execução e integração
Estado: **PROPOSTA** (não aceita). Origem: decisão do responsável, complemento à R0-01, 22/11/2026.
Não altera contratos protegidos (`governance/`, `contracts/`). Mudança de requisito/decisão só por regra protegida (raiz/revisor/verificador). Registrar como delta a ratificar em R0-08/R0-11.

## Decisão proposta
O OpenBot é a camada de execução, integração e operação da organização agêntica. Conexões já existentes no OpenBot (provedores de IA, MCPs, redes sociais, mLabs, analytics) são reutilizadas; não se duplicam integrações, OAuth ou gestão de tokens. Integração direta adicional só com demonstração de que o OpenBot não atende o requisito.

## Permanece no Loyalty News
Portal, LN Studio, CMS, banco de dados, Entity Intelligence, inventário publicitário, CRM comercial, mídia kit, governança, FinOps, auditoria e persistência dos resultados.

## Não muda
- 64 agentes, 28 rituais, 10 editorias, 19 workflows, escopo integral 2.1.
- Segregação executor / revisor (provedor distinto) / verificador. Credenciais operacionais do OpenBot **não** são identidades criptográficas de aceite (GPG executor/revisor/verificador/raiz).
- Teto agregado US$ 50/mês para APIs tarifadas; reserva atômica e bloqueio no gateway do Loyalty News. Uma conexão existente não implica disponibilidade ilimitada nem ausência de custo.
- Parada de emergência acionável pelo responsável sem passar por agente; nenhum segredo em repo, prompt ou evidência.

## Tensões a resolver (não resolvidas aqui)
1. **FinOps:** o teto e a reserva atômica (Blueprint §5) exigem medir tokens/custo/cache por tarefa. Se o OpenBot chamar os provedores diretamente, o gateway do Loyalty News deixa de ver o gasto. Requer verificar se o OpenBot expõe uso por execução/provedor/modelo, ou se as chamadas passam pelo gateway.
2. **Fact-checker em provedor diferente do redator** e classe de dado/provedor permitido: depende de o OpenBot permitir escolher modelo e provedor por tarefa (R2-10 já prevê "modelo por tarefa").
3. **Publicação só pela identidade de publicação** (F-044): agentes de redação não recebem credencial de rede social; o OpenBot precisa segregar permissões por canal e por agente.
4. **Blueprint §4/§5** descrevem gateway próprio e conectores diretos (mLabs, GA4); a proposta os torna, quando atendidos pelo OpenBot, camada fina de política/medição. Delta a ratificar.
5. **OpenBot em máquina autorizada (R2-09)**: não instalado nesta entrega.

## OpenBot Adapter — critérios a avaliar (R2-10)
Disparo de tarefas; eventos/webhooks assinados; resultado estruturado; persistência no banco do projeto; idempotência; recuperação de falhas; controle de concorrência; métricas de execução; orçamento/custo; parada de emergência.

## Pendências
Inventário do OpenBot (ver `docs/r0-01/inventario_openbot.md`) ainda não realizado: o OpenBot não é acessível a esta sessão.
