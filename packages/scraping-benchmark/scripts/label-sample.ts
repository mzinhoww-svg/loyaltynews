/**
 * Amostra para rotulagem INDEPENDENTE (ressalva QA 3, M2, achado 1): 5 pares por provedor (8 provedores = 40),
 * estratificados entre aprovados e reprovados pelo critério automático, semente fixa. O rotulador abre a URL pública e julga:
 * título correto? fonte correta? o retorno contém texto editorial da matéria (não navegação/ficha)? par duplicado?
 * Este bot NÃO rotula (não homologa a própria entrega). Saída: data/runs/<runId>/label-sample.csv
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AttemptRecord, DatasetEntry } from '../src/types.ts';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2] ?? 'run-20261123-01';
const dir = join(PKG, 'data', 'runs', runId);
const ds: DatasetEntry[] = JSON.parse(readFileSync(join(PKG, 'data', 'dataset.json'), 'utf8'));
const byId = new Map(ds.map((d) => [d.id, d]));
const recs: AttemptRecord[] = readFileSync(join(dir, 'attempts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r: AttemptRecord) => !r.mock && byId.has(r.urlId) && r.errorClass !== 'budget_blocked' && r.technicalSuccess);
let seed = 20261123;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const shuffle = <T,>(a: T[]) => a.map((x) => [rnd(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const rows: string[][] = [['provider', 'urlId', 'url', 'referenceTitle', 'extractedTitle', 'textLength', 'snippet200', 'auto_editorial', 'auto_reason', 'L_title_ok(s/n)', 'L_source_ok(s/n)', 'L_editorial_text(s/n)', 'L_notes']];
for (const p of [...new Set(recs.map((r) => r.provider))].sort()) {
  const mine = recs.filter((r) => r.provider === p);
  const pass = shuffle(mine.filter((r) => r.editorialSuccess)).slice(0, 3);
  const fail = shuffle(mine.filter((r) => !r.editorialSuccess)).slice(0, 2);
  const pick = [...pass, ...fail, ...shuffle(mine.filter((r) => r.editorialSuccess && !pass.includes(r)))].slice(0, 5);
  for (const r of pick) rows.push([p, r.urlId, r.url, byId.get(r.urlId)!.referenceTitle, r.title ?? '', String(r.textLength), r.snippet ?? '', String(r.editorialSuccess), r.errorClass, '', '', '', '']);
}
const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""').replace(/\s+/g, ' ')}"`).join(',')).join('\n');
writeFileSync(join(dir, 'label-sample.csv'), '﻿' + csv + '\n');
console.log(`amostra: ${rows.length - 1} pares → ${join(dir, 'label-sample.csv')}`);
