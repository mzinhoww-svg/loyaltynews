# Conteúdo institucional do lançamento (www.loyaltynews.com.br), revisado em 24/11/2026

> Pedido do proprietário: Quem somos, Política editorial, Correções, Contato, Termos e Privacidade/LGPD "revisados e prontos para publicar pelo CMS". **Onde vivem hoje:** as páginas institucionais **não são do CMS do Studio** (o CMS edita matérias, pautas e correções); são código do portal, em `apps/web/app/(portal)/_lib/institutional.ts`, uma entrada por página. **Publicar = o deploy normal do portal**; não há tela para o editor mudar esses textos. Esta entrega reescreve as seis entradas ali (mesmas rotas) e os testes conferem o que elas dizem.

## O que foi revisado, página por página

| Página (rota) | O que mudou | O que o texto afirma e onde o produto sustenta |
|---|---|---|
| **Quem somos** (`/sobre`) | Título passa de "Sobre o Loyalty News" a "Quem somos" (a rota e o link do rodapé "Sobre" seguem). Novas seções "Quem produz", "De onde vem a informação" e "Fale com a gente". | Assinatura institucional "Redação Loyalty News" (`ASSINATURA`, D09); automação e IA em etapas do processo, sem prometer que toda matéria é lida por uma pessoa (a publicação pode ser automática pela rota oficial); fonte primária obrigatória (gate `needs_primary_anchor`, DP-29). |
| **Política editorial** (`/politica-editorial`) | Novas seções "Fontes e atribuição", "Autoria e uso de inteligência artificial", "Imagens e ilustrações", "Erros e correções"; "Formatos" ganha o conteúdo autoral. | Lista de fontes com link em cada matéria (bloco "Fontes:" gerado); número, data e citação só se constam na fonte (gates de afirmação e de citação); citação curta entre aspas e nada de cópia (gate `copy_literal`, 8 palavras/30%); blogs e imprensa de nicho só como pista (tier secundário); aviso do conteúdo autoral (`AUTORAL_LABEL`) e sem falas (`autoral_quote`); imagem só com base de direito (D08); "Ilustração conceitual" (`ILLUSTRATION_LABEL`) creditada ao Loyalty News; checagem em provedor independente do redator (`cross_provider_check_failed`). |
| **Correções** (`/correcoes`) | Nova seção "Direito de resposta e pedidos de remoção"; o formulário passa a ser citado como canal de direitos autorais; os campos do formulário são nomeados. | Fluxo de correção e direito de resposta com decisão e data registradas (módulo de correções, DP-38); formulário `/correcoes#pedido` pede nome, e-mail para resposta, endereço da página, tipo (correção ou remoção) e descrição (`PedidoTitularForm`). Sem prazo legal prometido (R0-10 pendente). |
| **Privacidade e LGPD** (`/privacidade`) | Nova seção "Quais dados tratamos"; "Direitos do titular" inclui quem aparece em Pessoas (Intelligence); o canal provisório do titular é o formulário. | Dados do formulário (os cinco campos); Intelligence só nome, cargo, empresa e período de fonte oficial (DP-38); GA4 só com aviso e controle; "não vendemos lista de e-mails". **Mantém o aviso de minuta** e a pendência do controlador (R1-01). |
| **Termos de uso** (`/termos`) | Novas seções "Natureza das informações", "Publicidade e links" e "Responsabilidade" separadas. | Conteúdo protegido, citação com crédito e link; informação jornalística, não recomendação; ofertas e regras de programas mudam (conferir na fonte). **Mantém o aviso de minuta.** |
| **Contato** (`/contato`) | Separa "Pedidos que já têm canal" (o formulário de correções funciona hoje) dos "Demais canais" (e-mail e redes, ainda não confirmados). | Não exibe e-mail nem rede social (nenhum está definido); o teste do portal continua barrando e-mail e rede no texto. |

Também mantidos sem mudança: Metodologia e Publicidade (já corretas). O domínio do lançamento (`https://www.loyaltynews.com.br`) não aparece no texto das páginas; fica na configuração do portal.

## O que impede publicar como "versão final" (só o proprietário ou o jurídico resolvem)

1. **Controlador dos dados:** razão social, CNPJ e endereço (pendência R1-01). Hoje a página de privacidade diz que serão publicados antes do lançamento.
2. **Encarregado de dados (DPO):** nome e canal.
3. **E-mails oficiais** de redação, comercial, privacidade e direitos autorais, e **redes oficiais**. Sem eles, `/contato` só pode apontar o formulário de correções (que já funciona). Quando existirem, entram em `institutional.ts` e o teste do portal que barra e-mail precisa ser ajustado de propósito.
4. **Parecer jurídico** (R0-10/F-090) sobre Privacidade, Termos e Publicidade: os três continuam com o aviso "Minuta ... sujeita à validação jurídica" (o teste do portal exige o aviso).
5. **Prazos de resposta** a titulares e a pedidos de correção e direito de resposta: nenhum prazo foi escrito porque nenhum foi definido.
6. **Cookies e GA4:** o texto diz que a medição só será ativada com aviso e controle; falta o banner/preferências estarem de fato no ar antes de ligar o GA4.
7. **Newsletter:** o texto de privacidade a cita só como "quando existirem"; se não houver newsletter no lançamento, o item pode sair.
8. **Retenção** dos pedidos do formulário (por quanto tempo guardar nome e e-mail): não está definida; a privacidade não afirma nada sobre prazo de guarda.

## Cláusulas que NÃO escrevi (decisão de negócio ou do jurídico)

Proibição de extração automatizada do portal, limitação de responsabilidade, foro e lei aplicável, regras de comentários e de usuário logado, uso de marca. Se o proprietário quiser, entram na minuta de Termos já com o parecer.

## Como conferir

`apps/web/lib/institucional-lancamento.test.ts` (4 testes): as seis páginas e suas seções; assinatura, rótulo de ilustração, aviso autoral e campos do formulário batendo com o código; sem e-mail, rede social, CNPJ, prazo legal nem promessa de revisão humana de toda matéria; avisos de minuta mantidos; a política não contradiz o processo (fonte secundária só pista, número e citação só com fonte, IA declarada).
