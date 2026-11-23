// TEMPORÁRIO (não vai para o git): data/seed.public.v7.json = v6 + relações entre organizações de fontes oficiais; corrige a citação do Eros Canedo.
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeEntities } from './scripts/verify-dataset.mjs';

const v6 = JSON.parse(readFileSync('data/seed.public.v6.json', 'utf8'));
const S = (id, name) => ({ id, name, url: JSON.parse(readFileSync(`data/captures/${id}.meta.json`, 'utf8')).url, method: 'capture' });
const sources = [
  S('lp-banco-do-brasil', 'LATAM Pass — Parceiros: Banco do Brasil'),
  S('lp-bradesco', 'LATAM Pass — Parceiros: Bradesco'),
  S('lp-livelo', 'LATAM Pass — Parceiros: Livelo'),
  S('lp-esfera', 'LATAM Pass — Parceiros: Esfera'),
  S('bv-acionaria', 'Banco BV RI — Composição Acionária'),
  S('santander-esfera', 'Santander — Blog: Esfera, o programa de pontos do Santander'),
  S('livelo-dotz', 'Livelo — Trocar pontos: parceiro Dotz'),
  S('mc-emissores', 'Mastercard Brasil — Emissores de cartões Mastercard no Brasil'),
];
const rel = (from, to, type, sourceId, quote, contextQuote) => ({ from, to, type, sourceId, quote, ...(contextQuote ? { contextQuote } : {}) });
const relations = [
  rel('latam-pass', 'banco-do-brasil', 'partner_of', 'lp-banco-do-brasil', 'Para transferir seus pontos do Banco do Brasil (Livelo) para o LATAM Pass'),
  rel('latam-pass', 'bradesco', 'partner_of', 'lp-bradesco', 'Transfira seus pontos dos cartões Bradesco para o LATAM Pass'),
  rel('latam-pass', 'livelo', 'partner_of', 'lp-livelo', 'Taxa de conversão 1 Ponto Livelo 1 Milha LATAM Pass'),
  rel('latam-pass', 'esfera', 'partner_of', 'lp-esfera', 'Transfira seus pontos dos cartões Santander para o LATAM Pass'),
  rel('banco-do-brasil', 'livelo', 'other', 'lp-livelo', 'A Livelo é o Programa de Recompensas criado pelo Banco do Brasil e Bradesco'),
  rel('banco-do-brasil', 'banco-bv', 'other', 'bv-acionaria', 'e pelo Banco do Brasil, instituição financeira com mais de 200 anos de experiência', 'Contamos com uma base acionária robusta, composta pelo Grupo Votorantim'),
  rel('santander', 'esfera', 'other', 'santander-esfera', 'Esfera: conheça o programa de pontos do Santander'),
  rel('livelo', 'dotz', 'partner_of', 'livelo-dotz', 'Use seus pontos Livelo na rede Dotz para pagar parte das suas compras'),
  rel('mastercard', 'bradesco', 'partner_of', 'mc-emissores', 'Bradesco Central de Atendimento', 'Emissores de cartãoes Mastercard no Brasil'),
];
const orgs = [{ key: 'santander', legalName: 'Santander', kind: 'other', sourceId: 'santander-esfera', quote: 'Esfera: conheça o programa de pontos do Santander' }];
const norm = (s) => s.normalize('NFC').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const keys = new Set([...v6.organizations.map((o) => o.key), ...orgs.map((o) => o.key)]);
let bad = 0;
for (const r of [...relations, ...orgs.map((o) => ({ ...o, from: o.key, to: o.key }))]) {
  const t = norm(decodeEntities(JSON.parse(readFileSync(`data/captures/${r.sourceId}.json`, 'utf8')).text));
  for (const q of [r.quote, r.contextQuote].filter(Boolean)) if (!t.includes(norm(q))) { bad++; console.log('NÃO ACHADO:', r.from, r.to, '|', q); }
  if (!keys.has(r.from) || !keys.has(r.to)) { bad++; console.log('ORG DESCONHECIDA', r.from, r.to); }
}
const roles = v6.roles.map((r) => (r.personName === 'Eros Canedo' ? { ...r, quote: 'Eros Canedo CFO' } : r));
const { expiredRelations, ...rest } = v6; // a Santander→Esfera volta declarada (nova fonte): a marcação "validação vencida" do v5 não se aplica mais
void expiredRelations;
const ds = {
  ...rest, datasetId: 'seed.public.v7',
  description: `${v6.description} v7: + 9 relações entre organizações de páginas oficiais (LATAM Pass↔Banco do Brasil/Bradesco/Livelo/Esfera, BB→Livelo, BB→BV, Livelo→Dotz, Mastercard→Bradesco) e a Santander→Esfera confirmada por nova fonte oficial (Santander volta ao conjunto; sai a marcação "validação vencida"); corrige a citação do Eros Canedo.`,
  sources: [...v6.sources, ...sources], organizations: [...v6.organizations, ...orgs], relations: [...v6.relations, ...relations], roles,
};
writeFileSync('data/seed.public.v7.json', JSON.stringify(ds, null, 2) + '\n');
console.log(`orgs ${ds.organizations.length}, relações ${ds.relations.length} (+${relations.length}), cargos ${ds.roles.length}, fontes ${ds.sources.length}, não achados ${bad}`);
