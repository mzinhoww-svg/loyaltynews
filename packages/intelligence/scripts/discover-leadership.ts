/**
 * Descoberta (só links) das páginas de diretoria/administração de cada fonte, pelo Exa restrito ao domínio (≈ US$ 0,004 por busca,
 * cota gratuita mensal). Imprime URL e título; NUNCA texto de página nem segredo. Chave lida do cofre só dentro do processo.
 * Uso: node node_modules/.cache/ln-intelligence/discover-leadership.mjs host1 host2 …
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExaDiscoverer } from '../src/index';

const VAULT = process.env.LN_VAULT_DIR ?? 'C:/Users/mazin/AppData/Roaming/OpenBot/agent-api-keys/.vault/agent-2668b5a1-5627-4692-a689-8524a4d5d3ef';
const f = join(VAULT, 'EXA_API_KEY');
if (!existsSync(f)) { console.error('chave do Exa ausente'); process.exit(2); }
let key = readFileSync(f, 'utf8').trim();
if (key.startsWith('{')) { try { const j = JSON.parse(key) as Record<string, unknown>; key = String(j.value ?? j.key ?? key); } catch { /* usa o texto */ } }
const scrub = (s: string) => s.split(key).join('***');

const d = new ExaDiscoverer({ keys: [{ label: 'conta-1', secretRef: 'K', monthlyCreditCap: 10_000 }], resolveSecret: () => key });
for (const host of process.argv.slice(2)) {
  try {
    const links = await d.discover({ host, limit: 8, query: 'diretoria executiva, conselho de administração e administração da companhia' });
    console.log(scrub(JSON.stringify({ host, links: links.map((l) => ({ url: l.url, titulo: l.title?.slice(0, 90) })) })));
  } catch (e) {
    console.log(scrub(JSON.stringify({ host, erro: String((e as Error).message) })));
  }
}
console.log(JSON.stringify({ usoLocalEmCreditos: d.pool.report()[0]?.usedInMonth }));
