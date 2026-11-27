// Inventário dos escritores de public.audit_log (parecer do QA 6, F2). Escritor novo, ou um destes sem a barreira, reprova aqui.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const FORA = new Set(['node_modules', 'dist', '.next', '.next-e2e', 'coverage', 'test-results', 'drizzle', 'e2e']);
/** INSERT, UPDATE, DELETE ou TRUNCATE em audit_log, por SQL ou pelo Drizzle. */
const ESCRITA = /(insert\s+into|update|delete\s+from|truncate(\s+table)?)\s+("?public"?\s*\.\s*)?"?audit_log\b|\.(insert|update|delete)\(\s*(schema\.)?auditLog\b/i;

function arquivos(dir: string): string[] {
  return readdirSync(`${RAIZ}${dir}`, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return FORA.has(e.name) ? [] : arquivos(`${dir}/${e.name}`);
    return /\.(ts|tsx|mts|js|mjs|cjs)$/.test(e.name) && !/\.(test|spec)\.|testkit/.test(e.name) ? [`${dir}/${e.name}`] : [];
  });
}
const ler = (f: string) => readFileSync(`${RAIZ}${f}`, 'utf8');

/** Quem escreve texto: tem de passar as colunas por sanitizeAuditRow. */
const COM_BARREIRA = ['apps/web/app/api/_lib/intelligence/cargos.ts', 'apps/workers/src/intelligence-alerts.ts', 'packages/auth/src/audit.ts'];
/** Só anula o IP (exceção ao append-only da migração 0033): não grava texto. */
const SO_ANULA_IP = 'apps/workers/src/audit-ip-retention.ts';

describe('escritores de audit_log', () => {
  const escritores = ['apps', 'packages', 'infra'].flatMap(arquivos).filter((f) => ESCRITA.test(ler(f))).sort();

  it('o inventário é exatamente este', () => {
    expect(escritores).toEqual([...COM_BARREIRA, SO_ANULA_IP].sort());
  });

  it.each(COM_BARREIRA)('%s passa pela barreira antes de cada escrita', (f) => {
    const fonte = ler(f);
    const escritas = fonte.match(new RegExp(ESCRITA.source, 'gi'))!.length;
    expect(fonte.match(/sanitizeAuditRow\((?!e: Pick)/g)?.length ?? 0).toBeGreaterThanOrEqual(escritas);
  });

  it('a retenção do IP só atribui NULL à coluna ip', () => {
    expect(ler(SO_ANULA_IP).match(/UPDATE\s+audit_log\s+SET\s+[^W]+WHERE/gi)).toEqual(['UPDATE audit_log SET ip = NULL WHERE']);
  });

  it('o detector reconhece as formas de escrita (controle)', () => {
    for (const s of ['INSERT INTO public.audit_log (id)', 'insert into "public"."audit_log" values', 'db.insert(schema.auditLog).values(x)', '.update(auditLog)', 'DELETE FROM audit_log']) expect(ESCRITA.test(s), s).toBe(true);
    for (const s of ['SELECT * FROM audit_log', '.from(schema.auditLog)', 'INSERT INTO editorial_audit']) expect(ESCRITA.test(s), s).toBe(false);
  });
});
