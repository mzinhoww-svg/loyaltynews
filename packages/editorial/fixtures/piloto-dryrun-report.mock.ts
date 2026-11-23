// MOCK — gera o relatório Markdown do ensaio do piloto (dry-run) SÓ a partir do resultado: nenhum número é escrito à mão.
import type { DryrunReport } from './piloto-dryrun-run.mock';

const SRC_LABEL: Record<string, string> = {
  'senado-noticias': 'Agência Senado (feed RSS)', 'camara-noticias': 'Câmara Notícias (feed RSS)', abemf: 'ABEMF (feed)',
  'livelo-imprensa': 'Livelo imprensa (sitemap /imprensa/)', abrarec: 'ABRAREC (feed)',
};
const esc = (s: string) => s.replace(/\|/g, '\\|');
const FENCE = '```';

export function renderDryrunMarkdown(r: DryrunReport): string {
  const L: string[] = [];
  const aprov = r.materias.filter((m) => m.status === 'aprovado');
  const gaps = r.espacamento.map((e) => e.menorIntervaloSeg).filter((x): x is number => x !== null);
  L.push('# Ensaio do piloto em dry-run (5 fontes do checklist, 10 matérias simuladas)');
  L.push('');
  L.push('> Gerado por `packages/editorial/src/tests/piloto-dryrun.test.ts` (com `LN_WRITE_DRYRUN=1`). Dados em `docs/piloto-dryrun.data.json`. **Tudo é simulado**: nenhuma rede, nenhum modelo, nenhuma habilitação real, nenhuma publicação.');
  L.push('');
  L.push('## Resultado');
  L.push('');
  L.push(`- **${r.resumo.total} matérias** simuladas (2 por fonte): **${r.resumo.aprovadas} aprovadas** pelos gates e **${r.resumo.bloqueadas} bloqueadas** de propósito; **${r.resumo.conformes}/${r.resumo.total}** fizeram exatamente o que o cenário previa (status, bloqueio e achado do gate).`);
  L.push(`- **Chamadas a modelo real: ${r.chamadasModeloReal}.** Chamadas ao "modelo" simulado (saída roteirizada, custo 0): ${r.chamadasSimuladas} (${Object.entries(r.chamadasSimuladasPorClasse).map(([k, v]) => `${k} ${v}`).join(', ')}). Prompt fixado: \`${r.prompt}\`.`);
  L.push(`- **Publicadas: ${r.resumo.publicadas}.** Os ${r.resumo.recusadasPorSimulado} rascunhos gravados foram recusados pela publicação com \`simulated_content\` (o texto leva a marca SIMULADO).`);
  L.push(`- Coletor: 5 fontes coletadas, **2 evidências cada**; menor intervalo medido entre requisições ao mesmo host: **${gaps.length ? Math.min(...gaps) : 'n/d'} s** (exigido: 3 s). URLs proibidas requisitadas: ${r.requisicoesProibidas.length}.`);
  L.push('');
  L.push('## O que foi simulado e o que não foi');
  L.push('');
  L.push('| Parte | No ensaio |');
  L.push('|---|---|');
  L.push('| Fontes | Cadastro **real** das 5 fontes (host, prefixo, feed/sitemap, limites), com páginas e listagens **fictícias** servidas por um fetcher sem rede. Os hosts reais só servem de rótulo; nenhuma matéria real é lida. |');
  L.push(`| Habilitação | ${r.habilitacao}. A habilitação humana de verdade (Studio, \`docs/piloto-checklist-habilitacao.md\`) continua pendente. |`);
  L.push('| Coletor | **Real**: elegibilidade, robots.txt, anti-SSRF (resolvedor falso), host/prefixo, espaçamento de 3 s por host (relógio simulado), sitemap com prefixo verificado, dedupe. |');
  L.push('| Modelo | **Nenhum.** `RehearsalGateway` devolve saídas roteirizadas (provedores `simulado-*`), sem rede e com custo 0. |');
  L.push('| Gates, pipeline, store, publicação | **Reais** (os da Fábrica): 13 verificações determinísticas, checagem em provedor distinto, revisão, `applyPublication`. Store em memória. |');
  L.push('| Linha do piloto | Um `PilotRowSink` em memória recebe os patches que a planilha receberia (`output_valid`, `gate_verdict`, `cross_provider_ok`). |');
  L.push('');
  L.push('## Fontes');
  L.push('');
  L.push('| Fonte | Como é coletada | Evidências | Recusadas pelo coletor |');
  L.push('|---|---|---|---|');
  for (const f of r.fontes) L.push(`| \`${f.id}\` | ${SRC_LABEL[f.id] ?? f.id} | ${f.evidencias} | ${f.recusadas.length ? f.recusadas.map((k) => `\`${k.codigo}\` (${new URL(k.url).pathname})`).join(', ') : '—'} |`);
  L.push('');
  L.push('No Senado havia um item do feed em área que o `robots.txt` do ensaio proíbe: o coletor o recusou **sem requisitá-lo**. No Livelo, uma URL de produto fora de `/imprensa/` estava no sitemap e **não foi coletada**.');
  L.push('');
  L.push('| Host | Requisições | Menor intervalo entre requisições |');
  L.push('|---|---|---|');
  for (const e of r.espacamento) L.push(`| ${e.host} | ${e.requisicoes} | ${e.menorIntervaloSeg === null ? '—' : `${e.menorIntervaloSeg} s`} |`);
  L.push('');
  L.push('## As 10 matérias simuladas e os gates');
  L.push('');
  L.push('| # | Fonte | Cenário (o que o ensaio quer provar) | Esperado | Resultado | Bloqueio | Gate que barrou | Conforme |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const m of r.materias) {
    L.push(`| ${m.slot} | \`${m.fonte}\` | ${m.cenario} | ${m.esperado.status}${m.esperado.achado ? ` (\`${m.esperado.achado}\`)` : ''} | **${m.status}** | ${m.bloqueios.length ? m.bloqueios.map((b) => `\`${b}\``).join(', ') : '—'} | ${m.gatesQueBarraram.length ? m.gatesQueBarraram.join(', ') : '—'} | ${m.conforme ? '✓' : '✗'} |`);
  }
  L.push('');
  L.push('Achados que cada gate devolveu nas bloqueadas (texto do gate real):');
  L.push('');
  for (const m of r.materias.filter((x) => x.status === 'bloqueado')) L.push(`- **${m.slot}** (${m.estagios.join(' → ')}): ${m.achados.map((a) => esc(a)).join(' · ')}`);
  L.push('');
  L.push('### Gates nas matérias aprovadas');
  L.push('');
  const names = aprov[0]?.gates?.map((g) => g.gate) ?? [];
  L.push(`| Gate | ${aprov.map((m) => m.slot).join(' | ')} |`);
  L.push(`|---|${aprov.map(() => '---').join('|')}|`);
  for (const n of names) L.push(`| ${n} | ${aprov.map((m) => (m.gates?.find((g) => g.gate === n)?.verdict === 'pass' ? '✓' : '✗')).join(' | ')} |`);
  L.push('');
  L.push(`Checagem em provedor distinto nas aprovadas: ${aprov.every((m) => m.checagem?.independente) ? 'sim, todas (`simulado-checador` ≠ `simulado-redator`)' : 'NÃO em todas (defeito)'}.`);
  L.push('');
  L.push('## Linha do piloto (planilha) por matéria');
  L.push('');
  L.push('| # | `output_valid` | `gate_verdict` na redação | `gate_verdict` na checagem | `gate_verdict` na revisão | `cross_provider_ok` |');
  L.push('|---|---|---|---|---|---|');
  for (const m of r.materias) {
    const dr = m.linhasPiloto.find((x) => x.etapa === 'draft' && x.gate_verdict);
    const ov = m.linhasPiloto.filter((x) => x.output_valid !== undefined);
    const fc = m.linhasPiloto.find((x) => x.etapa === 'factcheck' && x.gate_verdict);
    const rv = m.linhasPiloto.find((x) => x.etapa === 'review' && x.gate_verdict);
    const cp = [fc, rv].filter((x) => x && x.cross_provider_ok !== undefined).map((x) => String(x!.cross_provider_ok)).join(' / ');
    L.push(`| ${m.slot} | ${ov.filter((x) => x.output_valid).length}/${ov.length} válidas | ${dr ? `${dr.gate_verdict}${dr.gate_reasons?.length ? ` (${dr.gate_reasons.join(', ')})` : ''}` : '—'} | ${fc?.gate_verdict ?? '—'} | ${rv?.gate_verdict ?? '—'} | ${cp || '—'} |`);
  }
  L.push('');
  L.push('## O que o ensaio mostrou (para o PM e o AgentOps)');
  L.push('');
  L.push('1. **Redação barrada por gate NÃO é refeita** (corrigido nesta rodada). Cópia literal, número fora da fonte, tom, resumo etc. são barreiras determinísticas: a matéria bloqueia na 1ª redação, com 1 chamada de redação (antes eram 3 por matéria barrada, `max_attempts`). Nova tentativa fica só para falha transitória (fila/gateway).');
  L.push('2. **O gate da redação grava `gate_verdict` e `gate_reasons` na planilha** (corrigido nesta rodada): matéria barrada na redação sai com `blocked` e os motivos na linha da tarefa de redação; aprovada, com `approved` e motivos vazios. A checagem e a revisão seguem como antes.');
  L.push('3. **Rótulo do bloqueio de tom.** O tom lint bloqueante (a6) sai com o código `unsupported_claim` (padrão de `FINDING_TO_BLOCKER`; não existe código próprio de tom); o achado `tone_title_exclamation` identifica o motivo. Não mudei isso (mexe no contrato dos códigos de bloqueio); fica para decisão do PM.');
  L.push('4. **Fonte com paywall `unknown` (Livelo)** só coleta depois que a revisão humana marca `paywall = none`; o ensaio simula essa revisão em memória.');
  L.push('');
  L.push('## O que este ensaio NÃO prova');
  L.push('');
  L.push('- Que as 5 fontes respondem hoje como no cadastro (a coleta real exige a habilitação humana e as flags; a Câmara responde 429 em rajada: 1 rodada por dia).');
  L.push('- A qualidade do texto de um modelo real, nem as taxas de `output_valid` e de `unsupported_facts` (isso é medição do piloto, com leitura humana).');
  L.push('- O banco real: o ensaio usa o store em memória; o store PostgreSQL tem contrato próprio, testado em PGlite e em PostgreSQL 18.');
  L.push('');
  L.push('## Como reproduzir');
  L.push('');
  L.push(FENCE);
  L.push('npx vitest run packages/editorial/src/tests/piloto-dryrun.test.ts                       # confere o ensaio e compara com os arquivos desta pasta');
  L.push('LN_WRITE_DRYRUN=1 npx vitest run packages/editorial/src/tests/piloto-dryrun.test.ts     # regrava piloto-dryrun.md e piloto-dryrun.data.json');
  L.push(FENCE);
  L.push('');
  return L.join('\n');
}
