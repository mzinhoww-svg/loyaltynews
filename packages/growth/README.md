# @loyaltynews/growth — Frente 09 (Growth e mLabs)
Sem dependências de runtime. Testes: `node --test "test/*.test.ts"` (Node ≥ 24, TypeScript por remoção de tipos). Amostras: `node scripts/render-sample.ts` (gera `out/samples/`, ignorado pelo git).

## Módulos
| Arquivo | O que faz |
|---|---|
| `src/mlabs/port.ts` | Interfaces `MlabsReadPort`/`MlabsWritePort`; listas de ferramentas de leitura e de escrita do mLabs |
| `src/mlabs/simulated.mock.ts` | **MOCK** — adaptador simulado (padrão): nada vai ao mLabs; recibos `SIM-…` |
| `src/mlabs/live.ts` | Adaptador real (exige `liveAck`; payload não mapeado: depende de R1-05/R5-02) e `readOnlyTransport` |
| `src/mlabs/validate.ts` | Validação de capacidades só por leitura (forma das respostas, sem valores) |
| `src/publisher/publisher.ts` | `SocialPublisher`: único caminho de publicação; só a identidade `publisher_social`; flags; gates; imagem aprovada; regras de copy; idempotência; auditoria |
| `src/copy/engine.ts` | Motor de copy LinkedIn + `validateCopy` (regras abaixo) |
| `src/creative/post.ts` | Criativo de contexto por código (SVG/HTML) a partir do brandkit; 4 formatos |
| `src/package/linkedin.ts` | Pacote por matéria: copy + criativo + slides de carrossel + `PublishRequest` + bloqueios |
| `src/package/instagram.ts` | Instagram construído; flag `growth_instagram_enabled` desligada |
| `src/flags.ts` | Flags (todas desligadas); migra para `packages/contracts/flags.ts` quando existir |

## Regras do motor de copy (validadas em código)
1. Só fatos aprovados, com fonte; sem fato com fonte, não há post. 2. Nenhum número que não conste em título/deck/fatos. 3. Marcação (`@[Nome]`) só para entidade com identidade verificada; sem ela, texto puro; sem suporte da API, fallback para texto puro. 4. Gancho ≤ 210 caracteres, texto ≤ 3000, ≤ 3 hashtags. 5. Link com UTM (LinkedIn), assinatura "Redação Loyalty News", crédito da imagem. 6. Sem apuração/entrevista/autoria humana inventada.

## Garantias de publicação (ADR-008)
- Redação/design/agentes recebem `identidade_nao_autorizada` (teste negativo). Esta guarda é de software; o controle real é só o serviço de publicação ter a credencial/MCP do mLabs.
- Instagram e The Loyal: chave desligada ⇒ recusa registrada na auditoria, mesmo pela identidade de publicação.
- Adaptador real só com `growth_linkedin_live` ligada; padrão: simulado. Sem imagem aprovada ou gates pendentes ⇒ bloqueia. Reenvio com a mesma chave não duplica.
- Criativo carrega `brandStatus` (brandkit está `proposal_not_approved`); o pacote lista `brandkit_proposal_not_approved` como bloqueio até aprovação.

## Não verificado / pendente
- Chamadas de leitura reais ao mLabs (ver `docs/mlabs-capabilities.md`); menção, edição, exclusão, PDF de carrossel, 7 dias sem sessão (R5-02).
- `tsc --noEmit` (sem `npm install` neste worktree; o scaffold ainda não tem workspaces); rodado apenas `node --test`.
- Handle de Instagram verificado (sem marcação no Instagram); texto do The Loyal não construído.
