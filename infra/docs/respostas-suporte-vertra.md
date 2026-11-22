# Respostas do suporte da Vertra às 7 perguntas (relatadas — NÃO verificadas por mim)
Fonte: conversa já existente no widget de chat do painel (aba do navegador do OpenBot), lida em 22/11/2026 enquanto eu preparava o deploy. Não enviei nada ao suporte e não toquei no chat. Quem fez as perguntas e a data/hora exatas: não identificado. Tratar como **informação do suporte, não confirmada em documento**; as respostas 4 e 6 são vagas.
| # | Pergunta (R0-07 / ADR-001) | Resposta do suporte | Efeito |
|---|---|---|---|
| 1 | País/datacenter | Apps e bancos no mesmo datacenter, **EUA (costa leste)**; Blob e snapshots em armazenamento de objetos também na costa leste da América do Norte (o painel mostra `nyc1`) | Dado pessoal fica sujeito a **J-10 (transferência internacional)**: confirma o risco que a ADR-001 já registrava |
| 2 | Rede privada app↔banco | **Não.** Sempre pelo endereço público do banco | TLS verify-full + certificado de cliente continuam obrigatórios (já são) |
| 3 | PITR | **Não há.** Há backup diário automático (30 dias) e snapshots manuais; snapshot restaura no próprio banco ou cria banco novo | RPO só pelo backup externo a cada 6 h (ADR-012) |
| 4 | Redis persiste? Política de descarte? | "Sim" (ambígua: parece responder só à persistência; a política `maxmemory-policy` **não foi respondida**) | Reperguntar a política; relevante para o dedupe do ad server (Redis, `sub-contar, nunca inflar`) |
| 5 | Logs de aplicação | Terminal do painel mostra só a execução atual, com limite de tamanho, **zerado a cada deploy ou reinício**; logs de build e de falha: os **20 mais recentes de cada tipo**; **sem retenção longa nem exportação**; recomendam enviar os logs a um serviço externo | A estratégia de `get_logs` periódico (observabilidade.md) **não serve**: a app precisa **enviar logs a um destino externo** (não implementado; decisão e custo do proprietário) |
| 6 | Limite de saída e conexões | Há limite de banda para apps e bancos; "até 100 conexões" (não diz por banco ou por conta) | Dimensionar pools (web + workers somam < 100 conexões ao PostgreSQL) |
| 7 | Tempo de restauração | Depende do tamanho dos dados | RTO só se mede no ensaio de restauração |
Pendente: confirmar por escrito (suporte) as respostas 4 e 6; o envio a terceiros segue com o PM/proprietário.
