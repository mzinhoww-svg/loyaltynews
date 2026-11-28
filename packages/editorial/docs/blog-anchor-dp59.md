# Blog como âncora principal (DP-59)

Decisão do proprietário de 25/11/2026, confirmada pela DP-103 (28/11). Lista em `src/rules/blog-anchor.ts`: **Passageiro de Primeira** e **Mestre das Milhas**.
Outro blog só entra por decisão registrada e commit revisado.

| O que muda | O que continua igual |
|---|---|
| Matéria só com post desses blogs não é mais barrada por `needs_primary_anchor` | Checagem por provedor diferente do redator |
| Número e data podem se apoiar no blog, atribuídos | Revisão independente |
| A fábrica redige mesmo sem página oficial linkada; as linkadas (fontes habilitadas) entram como confirmação | Link no bloco "Fontes:" e correção pública pelo fluxo do Studio |
| O prompt ganha a regra 7 (versão registrada `editorial-0.3+dp59`) | Não reproduzir: limite de cópia de fonte secundária |
| | Citação entre aspas pede fonte primária; matéria autoral pede 2 fontes primárias |

Regras automáticas (parecer 68): nada entre aspas sem fonte primária que contenha o trecho; quando só o blog ancora, o nome dele precisa estar no texto; sem página oficial, ou com
página linkada que não pôde ser lida, a matéria leva o achado `blog_unconfirmed` para a revisão. A fábrica lê esses blogs só com as travas de `collector/restricted.ts`.

Limites: A evidência só ancora se lida pelo coletor, no host do blog, em
https, sem instrução embutida. O prompt do piloto fixado em `packages/agents` não foi alterado; ele pede homologação própria antes de usar a regra 7.
