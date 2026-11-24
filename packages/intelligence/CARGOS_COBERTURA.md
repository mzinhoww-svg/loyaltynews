# Cobertura dos cargos públicos nas 29 organizações (fase 3)

Regra: só página **oficial** de RI/governança/imprensa da própria empresa (ou do grupo que a página nomeia expressamente), citação literal com nome e cargo, nunca vínculo presumido por controle societário ou por nome parecido. LinkedIn/The Org só como fonte **secundária** ("a confirmar", inferido, nunca fato no portal); **nenhuma leitura dessas duas foi feita nesta fase** (ver o fim). Conjunto: `data/seed.public.v5.json` (verificador 87/87). Textos das páginas só locais; no git, metadados (`data/captures/*.meta.json`).

| Organização | Cargos no v5 | Fonte (página oficial) | Observação |
|---|---|---|---|
| Bradesco | 3 | bradescori.com.br — Diretoria Executiva | v4 |
| Banco do Brasil | 3 | ri.bb.com.br — Conselho Diretor | v4; e-mails da página não copiados |
| Banco Santander (Brasil) | 2 | santander.com.br/ri — Management Board | v4 |
| Dotz | 2 | ri.dotz.com.br — Administração | v4 |
| BRB | 3 | ri.brb.com.br — Administração | v4 |
| Banco BV | 1 | ri.bv.com.br — Diretoria, Conselhos e Comitês | v4 |
| GPA | 1 | gpari.com.br — Administração | v4; início = data de eleição da página |
| LATAM | 2 | ir.latam.com — Alta Administração | v4; só pelo leitor em modo navegador do provedor |
| Uber | 2 | investor.uber.com — Governance | v4 |
| Raia Drogasil | 1 | ri.rdsaude.com.br — Governança | v4; só o presidente do Conselho (a página não traz a diretoria executiva em texto) |
| Livelo | 1 | livelo.com.br/imprensa — balanço 2025 | release da própria Livelo cita o CEO; não há página de diretoria |
| Mastercard | 2 | mastercard.com/news/latin-america — Biografias | liderança regional (América Latina e Caribe), com o cargo como a página o escreve |
| Orbia | 1 | orbia.com — Equipo de liderazgo | CEO |
| Bradesco Seguros | 2 | bradescoseguros.com.br — Executivos do Grupo Segurador | |
| Grupo Santander | 2 | santander.com — Consejo de administración | presidenta ejecutiva e consejero delegado (cargos do conselho) |
| Madero | 3 | ri.grupomadero.com.br — Diretoria e Conselho | |
| Shopee | 1 | sea.com — Our Leadership | página da controladora **que nomeia o cargo na Shopee** ("Chief Product Officer, Shopee"); só esse, nada por extensão |
| **Sem cargos (12)** | | | |
| Azul, Smiles | 0 | — | **classe C da DP-28** (só com revisão caso a caso do proprietário/J-14); não lidas como fonte |
| ABEMF | 0 | web.abemf.com.br/abemf/ | a página tem "Palavra do Presidente" sem nome; não se presume |
| LATAM Pass, Esfera, Santander (marca), Stix, Km de Vantagens, Juntos Somos +, Clube Giro, Bravium, Genial | 0 | — | nenhuma página oficial pública de diretoria encontrada (busca por domínio; Km de Vantagens é página da Ipiranga sem dirigentes). **Não se presume pelo controlador** (ex.: o CEO da LATAM não é registrado como cargo da LATAM Pass) |

**Santander→Esfera está "validação vencida" no v5 (decisão do PM, não se apaga):** a página inicial da Esfera mudou (o título era "Esfera: O programa de pontos e recompensas do Santander" e hoje é só "Esfera"), então a citação do v3 não existe mais na fonte desde 23/11/2026. A relação passa a inferida com a base "validação vencida em 2026-11-23: …" (`expiredRelations` no conjunto): **fora do portal**, visível no Studio com `stale_validation: true`, até uma nova fonte verificada confirmar (então a MESMA relação volta a declarada). **Feito no v7:** o blog oficial do Santander voltou a afirmar "Esfera: conheça o programa de pontos do Santander".

## Relações entre as 29 organizações (seed v7)
Ver `STAGING_LOAD_PLAN.md` "Carga v7". 36 relações (27 do v3 + 9 novas), todas de página oficial com citação literal: parcerias de pontos (LATAM Pass com Banco do Brasil, Bradesco, Livelo e Esfera; Livelo→Dotz; Mastercard→Bradesco), criação da Livelo (Banco do Brasil e Bradesco), acionista do Banco BV (Banco do Brasil) e Santander→Esfera. **Não encontrado em página oficial (ficou fora, nada presumido):** controle da Livelo por percentual, Bradesco→Bradesco Seguros (as páginas listam o Grupo mas não dizem "controladora" em texto estático), Esfera como empresa do Santander em texto oficial do Esfera (o blog do Santander afirma o programa), vínculos de Km de Vantagens/Clube Giro com seus controladores, e qualquer relação de Azul/Smiles (classe C). Páginas de RI do Banco do Brasil e do Bradesco renderizam só por JavaScript (sem texto na leitura): fonte para uma próxima rodada com navegador.

## v8 — o que a busca por fonte OFICIAL achou (23/11/2026)
Das 12 organizações sem cargo oficial na v5: **ABEMF ganhou 1 cargo oficial** (Paulo Curro, diretor executivo; a página institucional não nomeia dirigentes, mas os artigos assinados do site da ABEMF identificam o diretor executivo). **Sem cargo oficial, de propósito:** Azul e Smiles (classe C da DP-28); LATAM Pass, Santander (marca) e Km de Vantagens (não têm página própria de diretoria; nada pelo controlador); Clube Giro, Juntos Somos +, Bravium (sites institucionais sem dirigentes nomeados em texto); Genial e Stix (sem página oficial pública lida); Esfera (a leitura da página "Sobre a Esfera" excedeu o tempo; a Esfera segue só com o cargo secundário e o v8 não o promove). Os 7 cargos "a confirmar" (de 5 organizações) **seguem inferidos**. PDFs da ABEMF (estatuto, código) voltam como bytes sem texto na leitura: não servem como fonte.

## Fonte secundária (seed v6, decisão do PM de 23/11/2026)
Leitura de **The Org** (página pública, sem login, ritmo baixo; provedor só quando a leitura direta recusa) para as organizações sem página oficial; entram como **secundária, "a confirmar"** (inferido), sem Move e sem fato no portal. **LinkedIn não foi lido nesta rodada**: a The Org já cobriu o que havia de página pública de organograma; perfil individual do LinkedIn é dado pessoal além do necessário, e a página de empresa costuma pedir login para listar pessoas (não verificado). Nada foi coletado de lá.
| Organização | Cargos "a confirmar" | Fonte | Observação |
|---|---|---|---|
| Genial | 1 (CEO) | theorg.com/org/genial-investimentos/teams/leadership | leitura por Zyte; "Genial Solar" (outra empresa) ignorada |
| Esfera | 1 | theorg.com/org/sphere-1 | a página The Org casa por nome ("Esfera") |
| Stix | 2 | theorg.com/org/soustix | |
| Juntos Somos + | 2 | theorg.com/org/juntos-somos-mais | |
| Bravium | 1 (CEO) | theorg.com/org/bravium | há também "Bravium Consulting Inc." na The Org: homônimo possível, por isso "a confirmar" |
| LATAM Pass | 0 | — | a The Org só tem a LATAM Airlines (grupo); nenhum cargo da página cita o programa em nível de liderança; não se atribui pelo controlador |
| Santander (marca) | 0 | — | marca/programa, sem entidade própria com pessoas |
| Km de Vantagens | 0 | — | só aparece como Ipiranga (controladora); não se presume |
| Clube Giro | 0 | — | só aparece como Grupo JCA (controladora); não se presume |
| ABEMF | 0 | — | nenhuma entidade correspondente na The Org |
Azul e Smiles seguem fora (classe C da DP-28).

## Próximos passos possíveis (precisam de decisão)
- Os 12 sem cargos: (a) revisão caso a caso da Azul e da Smiles/GOL (classe C); (b) leitura **secundária** (LinkedIn/The Org, só página pública, sem login, via provedor, ritmo baixo) para entrar como "a confirmar" — autorizada pelo proprietário, **não executada** (cada leitura é um acesso a terceiro; peço a lista de organizações e o OK do PM antes); (c) buscar página oficial por outros caminhos (comunicados, estatutos).
- Recoleta: o job de releitura (`REREAD_JOB.md`) cobre as 17 páginas oficiais do conjunto; páginas novas entram ao trocar o conjunto de referência do job.
