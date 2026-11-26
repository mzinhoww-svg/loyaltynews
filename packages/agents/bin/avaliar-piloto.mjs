#!/usr/bin/env node
// Avalia o piloto de 10 matérias a partir do CSV exportado do Studio (/studio/piloto → Exportar planilha).
//   node packages/agents/bin/avaliar-piloto.mjs --csv <arquivo> [--json]
// Sem rede, sem banco, sem segredo, sem chamada de modelo: só lê o arquivo e roda o `evaluatePilot` de `src/pilot.ts`.
// Saída 0 = APROVADO; saída 1 = qualquer outra coisa (reprovado, inválido, parado, inconclusivo, CSV malformado, erro de uso).
// Precisa de Node ≥ 22.18 (o Node remove os tipos do TypeScript sozinho; não há etapa de build).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const AQUI = new URL('.', import.meta.url);
const { evaluatePilot, PILOT_SHEET_COLUMNS } = await import(new URL('../src/pilot.ts', AQUI).href);
const EXTRAS_STUDIO = JSON.parse(readFileSync(new URL('../fixtures/pilot-csv-consumers.json', AQUI), 'utf8')).studio_extras.columns;

const falha = (msg) => {
  console.error(`avaliar-piloto: ${msg}`);
  process.exit(1);
};

// --- argumentos --------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const iCsv = args.indexOf('--csv');
const arquivo = iCsv >= 0 ? args[iCsv + 1] : undefined;
const comoJson = args.includes('--json');
if (!arquivo || arquivo.startsWith('--')) falha('uso: node packages/agents/bin/avaliar-piloto.mjs --csv <arquivo> [--json]');

let texto;
try {
  texto = readFileSync(arquivo, 'utf8');
} catch {
  falha(`não consegui ler o arquivo ${basename(arquivo)}`);
}
if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1); // o export do Studio vem com BOM

// --- CSV (RFC 4180: aspas, vírgula e quebra de linha entre aspas) -------------------------------------------------------
function parseCsv(src) {
  const linhas = [];
  let linha = [];
  let cel = '';
  let aspas = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (aspas) {
      if (c === '"') {
        if (src[i + 1] === '"') { cel += '"'; i++; } else aspas = false;
      } else cel += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      linha.push(cel); cel = '';
      linhas.push(linha); linha = [];
    } else cel += c;
  }
  if (aspas) falha('CSV malformado: aspas sem fechar');
  if (cel !== '' || linha.length) { linha.push(cel); linhas.push(linha); }
  return linhas.filter((l) => !(l.length === 1 && l[0] === ''));
}

let linhas = parseCsv(texto);
if (linhas.length === 0) falha('CSV vazio');
// Marcador obrigatório: o export grava `# amostra_desde=<ISO do último resume>` antes do cabeçalho. Sem ele, o arquivo é de
// antes do resume (ou de exportador antigo) e não pode ser aceito como amostra.
const primeira = linhas[0];
let amostraDesde;
if (primeira.length === 1 && /^#\s*amostra_desde=/.test(primeira[0])) {
  amostraDesde = primeira[0].slice(primeira[0].indexOf('=') + 1).trim();
  if (!Number.isFinite(Date.parse(amostraDesde))) falha('marcador de amostra inválido: use # amostra_desde=<ISO 8601>');
  linhas = linhas.slice(1);
} else {
  falha('CSV sem marcador de amostra (# amostra_desde=<ISO>): arquivo gerado antes do resume ou por exportador antigo; exporte de novo pela planilha do piloto');
}
if (linhas.length === 0) falha('CSV sem cabeçalho depois do marcador de amostra');
const cab = linhas[0];

// --- cabeçalho: as 31 colunas do AgentOps, na ordem; depois, só as 7 do Studio (ignoradas) ------------------------------
const base = [...PILOT_SHEET_COLUMNS];
for (let i = 0; i < base.length; i++) {
  if (cab[i] !== base[i]) falha(`cabeçalho inválido: a coluna ${i + 1} deveria ser "${base[i]}" e é "${cab[i] ?? '(ausente)'}"; esperadas ${base.length} colunas do AgentOps, na ordem`);
}
const extras = cab.slice(base.length);
if (extras.length !== 0 && JSON.stringify(extras) !== JSON.stringify(EXTRAS_STUDIO)) {
  falha(`cabeçalho inválido: depois das ${base.length} colunas só podem vir, nesta ordem, as ${EXTRAS_STUDIO.length} do Studio (${EXTRAS_STUDIO.join(', ')}); encontrado: ${extras.join(', ')}`);
}

// --- linhas → PilotRow ------------------------------------------------------------------------------------------------
const OBRIGATORIAS = ['task_id', 'kind', 'stage', 'account', 'started_at', 'ended_at', 'attempt', 'outcome', 'tokens_measured', 'published_attempt', 'tarifada_api_call', 'secret_in_log', 'tool_outside_contract'];
const BOOLEANAS = new Set(['cross_provider_ok', 'output_valid', 'tokens_measured', 'published_attempt', 'tarifada_api_call', 'secret_in_log', 'tool_outside_contract']);
const NUMERICAS = new Set(['attempt', 'packet_chars', 'unsupported_facts', 'unsupported_high', 'unsupported_medium', 'unsupported_low']);
const LISTAS = new Set(['gate_reasons']);
// o Studio neutraliza fórmula de planilha com um apóstrofo; desfaz só nesse caso
const desneutraliza = (v) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

const rows = [];
for (let n = 1; n < linhas.length; n++) {
  const cel = linhas[n];
  if (cel.length !== cab.length) falha(`CSV malformado: a linha ${n + 1} tem ${cel.length} colunas e o cabeçalho tem ${cab.length}`);
  const r = {};
  for (let i = 0; i < base.length; i++) {
    const col = base[i];
    const bruto = desneutraliza(cel[i]);
    if (bruto === '') {
      if (OBRIGATORIAS.includes(col)) falha(`CSV malformado: a linha ${n + 1} tem a coluna obrigatória "${col}" vazia (campo ausente nunca vale como "não houve violação")`);
      r[col] = col === 'declared_model' || col === 'prompt_version' ? null : undefined;
      continue;
    }
    if (BOOLEANAS.has(col)) {
      if (bruto !== 'true' && bruto !== 'false') falha(`CSV malformado: a linha ${n + 1} tem "${col}" = "${bruto}" (esperado true ou false)`);
      r[col] = bruto === 'true';
    } else if (NUMERICAS.has(col)) {
      if (!/^\d+$/.test(bruto)) falha(`CSV malformado: a linha ${n + 1} tem "${col}" = "${bruto}" (esperado inteiro ≥ 0)`);
      r[col] = Number(bruto);
    } else if (LISTAS.has(col)) {
      r[col] = bruto.split(' | ').filter(Boolean);
    } else r[col] = bruto;
  }
  rows.push(r);
}
const desde = Date.parse(amostraDesde);
for (let n = 0; n < rows.length; n++) {
  if (!(Date.parse(rows[n].started_at) >= desde)) falha(`CSV fora da amostra: a linha ${n + 1} (${rows[n].task_id}) começou em ${rows[n].started_at}, antes do resume (${amostraDesde})`);
}
if (rows.length === 0) falha('CSV sem linhas de dados');

// --- avaliação (o avaliador homologado do piloto) -----------------------------------------------------------------------
const ev = evaluatePilot(rows);

const VEREDITO = { pass: 'APROVADO', fail: 'REPROVADO', invalid: 'INVÁLIDO', stopped: 'PARADO', inconclusive: 'INCONCLUSIVO' };
const veredito = VEREDITO[ev.exit.overall] ?? 'INCONCLUSIVO';
const corte = (s, n = 90) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

const motivos = [];
if (ev.exit.stopped) for (const s of ev.stop) motivos.push(`parada imediata: ${s}`);
if (ev.exit.sample === 'invalid') for (const r of ev.invalidRows) motivos.push(`linha inválida ${r.task_id}: ${r.errors.join('; ')}`);
if (ev.exit.independence === 'fail') for (const f of ev.independence.failures) motivos.push(`independência: ${f}`);
if (ev.exit.independence === 'inconclusive') motivos.push(ev.independence.checked === 0 ? 'independência: nenhuma checagem ou revisão independente nas linhas' : `independência: rascunho final sem checagem vinculada (${ev.independence.uncheckedFinalDrafts.join(', ')})`);
const q = ev.quality;
if (ev.exit.quality === 'fail') motivos.push(`qualidade: ${q.high} alta(s) (máximo 0) e ${q.medium} média(s) (máximo 1)${q.unclassifiedCountedAsHigh ? `; ${q.unclassifiedCountedAsHigh} fato(s) sem gravidade contado(s) como alto` : ''}`);
if (ev.exit.quality === 'inconclusive') motivos.push(q.approvedWithEvaluation + q.approvedWithoutEvaluation === 0 ? 'qualidade: nenhuma matéria aprovada pelo gate' : `qualidade: ${q.approvedWithoutEvaluation} matéria(s) aprovada(s) ainda sem leitura de fatos não suportados`);
if (ev.tariffed.apiCalls > 0) motivos.push(`custo: ${ev.tariffed.apiCalls} chamada(s) à API tarifada (esperado 0)`);
if (ev.exit.windowsMeasured === 'inconclusive') motivos.push('janelas de limite: sem linhas para medir');

if (comoJson) {
  console.log(JSON.stringify({ veredito, overall: ev.exit.overall, linhas: rows.length, motivos, exit: ev.exit, quality: ev.quality, tariffed: ev.tariffed, outputValidity: ev.outputValidity, independence: { checked: ev.independence.checked, ok: ev.independence.ok } }, null, 2));
} else {
  const L = [];
  L.push(`Avaliação do piloto: ${basename(arquivo)} (${rows.length} linhas)`);
  L.push(`VEREDITO: ${veredito}`);
  if (motivos.length) { L.push('Motivos:'); for (const m of motivos) L.push(`  - ${corte(m, 400)}`); }
  L.push('Critérios:');
  L.push(`  - amostra: ${ev.exit.sample === 'valid' ? 'válida' : 'INVÁLIDA'} (${ev.invalidRows.length} linha(s) inválida(s))`);
  L.push(`  - independência: ${ev.exit.independence} (${ev.independence.ok} de ${ev.independence.checked} checagens/revisões de autor diferente do redator)`);
  L.push(`  - qualidade: ${ev.exit.quality}; altas ${q.high}, médias ${q.medium}, baixas ${q.low} (critério: 0 altas e no máximo 1 média; baixas só anotadas; fato sem gravidade conta como alto)`);
  L.push(`  - violações: ${ev.stop.length} (publicar, API tarifada, segredo em log, ferramenta fora do contrato, conta fora da rota); as violações continuam contando mesmo depois de resolvidas no Studio`);
  L.push(`  - custo tarifado: ${ev.tariffed.apiCalls} chamada(s) à API (esperado 0)`);
  L.push(`  - janelas de limite: ${ev.exit.windowsMeasured}; ${ev.limitHits.length} limite(s) atingido(s)`);
  for (const h of ev.limitHits) L.push(`      · ${h.account} em ${h.at}: ${corte(h.message)}${h.resumedAt ? ` (retomou ${h.resumedAt})` : ' (sem retomada registrada)'}`);
  if (ev.backupsUsed.length) L.push(`  - backups usados: ${ev.backupsUsed.map((b) => `${b.stage}/${b.account}${b.model ? `/${b.model}` : ''} x${b.tasks}`).join(', ')}`);
  const v = ev.outputValidity;
  L.push(`DESTAQUE output_valid: ${v.rate === null ? 'sem linhas medidas' : `${(v.rate * 100).toFixed(1)}% (${v.valid} de ${v.checked})`}; limiar de 95% é INFORMATIVO e não reprova o piloto (PM-2026-11-23-J)`);
  console.log(L.join('\n'));
}
process.exit(ev.exit.overall === 'pass' ? 0 : 1);
