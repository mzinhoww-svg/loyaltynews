#!/usr/bin/env node
/**
 * Gera fontes-empresas.md a partir de data/fontes-empresas.candidatos.sonda.json (sem rede).
 * Uso: node scripts/gen-fontes-empresas-md.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const j = JSON.parse(readFileSync(`${root}data/fontes-empresas.candidatos.sonda.json`, 'utf8'));
const by = Object.fromEntries(j.fontes.map((r) => [r.id, r]));
const c = (s) => '`' + s + '`';
const row = (r) => `| ${r.nome} | ${r.tipo} | ${r.estado} | ${r.http_status ?? '—'} | ${r.texto_caracteres || '—'} | ${r.renderizacao ?? '—'} | ${r.sitemaps.length} | ${r.feeds_declarados.length} | ${(r.redireciona_para ? `→ ${r.redireciona_para}. ` : '') + (r.observacao || '').replace(/\|/g, '/')} |`;
const sitemaps = j.fontes.filter((r) => r.sitemaps.length).length;
const redir = j.fontes.filter((r) => r.estado === 'redirecionada');

const md = `# Fontes de empresas (RI e sites oficiais) — sonda de acessibilidade (DP-28/DP-29)

Para o Editorial cadastrar e para o fluxo humano de habilitação (Studio). Sonda refeita em ${j.gerado_em.slice(0, 10)} por ${c('scripts/probe-sources.mjs')} depois do parecer do QA 2 (dados em ${c('data/fontes-empresas.candidatos.sonda.json')}). **A sonda não habilita nada, não verifica conteúdo e não lê os termos de cada fonte** (J-14 caso a caso; a DP-28 aceita o risco do proprietário para fontes de mercado, exceto classe C).

## Regras seguidas (revisadas após o parecer do QA 2 sobre 480250c)
- **Redirecionamento NÃO é seguido**: a sonda registra o 3xx e o destino; o destino só é lido se for cadastrado como candidata própria, com o seu robots.txt. Nesta rodada ${redir.length} candidatas redirecionaram (Santander RI e RD Saúde para OUTRO host; Uber e Smiles para outro caminho do mesmo host) e os ${redir.length} destinos foram sondados como candidatas separadas (${c('*-destino')}). Um destino pode, por sua vez, redirecionar: o estado dele diz.
- **robots.txt pelo RFC 9309**: grupos por User-Agent, curinga ${c('*')} e âncora ${c('$')} em qualquer posição, regra mais longa vence, empate favorece Allow. Nenhuma decisão anterior mudou com o novo analisador (conferido de novo para as ${j.fontes.length} URLs).
- **Página de desafio/CAPTCHA com HTTP 200** vira ${c('bloqueada_desafio')} (título de desafio, cabeçalho ${c('cf-mitigated')}, marcadores de WAF e frase de verificação humana, em página de qualquer tamanho; widget de captcha só em página vazia ou curta que fale em verificação). Nunca contornado.
- ${c('robots.txt')} consultado antes de cada página; se proíbe ou não pôde ser lido, a página **não** foi buscada. **Uma requisição por URL**, pausa de 2 s, User-Agent identificado, sem repetir, sem trocar de User-Agent, sem rotas alternativas. 403/429/CAPTCHA = "bloqueada", ponto final.
- Classe C (Azul, GOL, ABECS, IATA, Nubank, Accor, Marriott, Salesforce, HubSpot, Zendesk, oneworld, ABAV) fora da lista.
- Quatro páginas "parciais ou casca" foram abertas **uma vez** no navegador do OpenBot (renderização JavaScript) para ver se há conteúdo: Stix, BRB RI, Vibra RI e Esfera.

## Resultado (${j.fontes.length} candidatas)
${Object.entries(j.resumo).map(([k, v]) => `- ${c(k)}: ${v}`).join('\n')}

## Reavaliação pedida (Editorial registrara "inacessível" em 22/11)
| Fonte | Hoje (23/11, para o User-Agent identificado) | Leitura |
|---|---|---|
| Livelo (imprensa) | HTTP ${by['livelo-imprensa'].http_status}, ${by['livelo-imprensa'].texto_caracteres} caracteres de texto estático, robots permite, ${by['livelo-imprensa'].sitemaps.length} sitemap declarado | **Acessível.** A página lista as manchetes da própria Livelo. Pode ter sido o User-Agent do coletor ou mudança do site; reavaliar no cadastro. |
| Magalu RI | HTTP ${by['magalu-ri'].http_status}, ${by['magalu-ri'].texto_caracteres} caracteres, ${by['magalu-ri'].robots} | **Acessível.** Sem robots.txt (nada a respeitar além da cortesia: uma requisição, espaçada). |
| Santander RI | ${c('ri.santander.com.br')} responde **redirecionamento (HTTP ${by['santander-ri'].http_status}) para ${c(by['santander-ri'].redireciona_para ?? '?')}**, que **não foi seguido**; o destino, sondado como candidata própria (${c('santander-ri-destino')}) com robots próprio, responde HTTP ${by['santander-ri-destino'].http_status}, ${by['santander-ri-destino'].texto_caracteres} caracteres | **Acessível pelo endereço de destino.** Cadastrar ${c('www.santander.com.br/ri/')} (o host antigo só redireciona). |

Observação honesta: "acessível" vale para **esta** leitura (uma requisição). Se o coletor do Editorial recebe 403 com o User-Agent dele, **não** contornar: registrar bloqueada e seguir por RSS/sitemap/newsletter pública.

## Tabela completa
| Fonte | Tipo | Estado | HTTP | Texto (caract.) | Renderização | Sitemaps no robots | Feeds declarados | Observação |
|---|---|---|---|---|---|---|---|---|
${j.fontes.map(row).join('\n')}

## O que isto significa para o cadastro
- **Feeds RSS/Atom**: nenhuma das ${j.fontes.length} páginas declara ${c('<link rel="alternate" type="application/rss+xml">')}. Para coleta, o caminho legítimo é **sitemap** (declarado no robots.txt de ${sitemaps} fontes) e as **seções de comunicados** dos RIs, com coleta espaçada. O LATAM IR teria RSS segundo o Editorial (22/11); a página principal respondeu 403 aqui: tentar o feed com o coletor e, se 403, registrar bloqueada.
- **Redirecionamentos**: cadastrar o destino, não a origem (ver os ${redir.length} casos acima). O Editorial deve aplicar a mesma regra no coletor: ler o robots.txt do host de destino antes de buscar.
- **Bloqueadas**: LATAM IR (HTTP 403, não repetido). **Natura, Inter e XP**: o host candidato estava errado (robots.txt ilegível); com os hosts corrigidos (ri.natura.com.br, investors.inter.co/en/, investors.xpinc.com/en/) as três respondem HTTP 200 com texto estático, robots permite e 1 sitemap declarado cada.
- **Só no navegador**: Dotz (site; já capturado no seed) e Stix. **Stix**: a página atual ("Stix.com.br | Em Evolução", 489 caracteres) não descreve um programa de fidelidade; não serve como fonte editorial e merece revisão humana.
- **Achado extra**: o título da página da Esfera diz "Esfera: O programa de pontos e recompensas do Santander" (em HTML estático). Isso sustenta uma relação Santander→Esfera com citação literal (seed v3).
- **Mastercard newsroom** (${by['mastercard-newsroom'].texto_caracteres} caracteres) e **Uber newsroom** respondem com texto estático; viram candidatas a fonte editorial de mercado após revisão humana.

## Limites
Uma leitura por URL em 23/11/2026; não é verificação de conteúdo; termos de uso de cada fonte **não** foram lidos aqui (a DP-28 aceita o risco, mas a revisão caso a caso vale para qualquer fonte com proibição expressa); "tipo" das candidatas é triagem, não fato.
`;
writeFileSync(`${root}fontes-empresas.md`, md);
console.log(`${md.split('\n').length} linhas`);
