/* eslint-disable @typescript-eslint/no-explicit-any -- linhas cruas */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { makeApp } from '../_lib/testkit';
import { seedCommercial } from '../_lib/commercial/repo';

// Migração 0023 (ad_creatives: arquivo, dimensões, hash e texto alternativo + CHECKs): as regras do banco, e subir/descer/subir de novo.
const DIR = fileURLToPath(new URL('../../../../../packages/db/drizzle/', import.meta.url));
const UP = readFileSync(`${DIR}0023_ad_creatives_arquivo.sql`, 'utf8');
const DOWN = readFileSync(`${DIR}down/0023_ad_creatives_arquivo.down.sql`, 'utf8');
const SHA = 'c'.repeat(64);
const COMPLETO = { arquivoRef: `anuncios/${SHA}.png`, arquivoMime: 'image/png', largura: 1280, altura: 150, tamanhoKb: 100, arquivoSha256: SHA, textoAlternativo: 'Oferta', destinoUrl: 'https://anunciante.example/x' };

let app: Awaited<ReturnType<typeof makeApp>>;
let n = 0;
const criar = (over: Record<string, unknown>) =>
  app.db.insert(schema.adCreatives).values({ id: `cr-${++n}`, campanhaId: 'cmp-1', slotId: 'TOP', peso: 1, inicio: '2026-11-01', fim: '2026-12-31', ...over } as any);

beforeAll(async () => {
  app = await makeApp();
  await seedCommercial(app.db);
  await app.db.insert(schema.crmAccounts).values({ id: 'acc-1', nome: 'Anunciante' });
  await app.db.insert(schema.campaigns).values({ id: 'cmp-1', nome: 'C', contaId: 'acc-1', formatoId: 'banners--banner-topo', slotId: 'TOP', inicio: '2026-11-01', fim: '2026-12-31', status: 'active' });
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('regras do banco para o criativo (CHECK)', () => {
  it('aprovado só com criativo COMPLETO (arquivo, mime, dimensões, peso, hash, texto alternativo e destino); sem aprovar, vazio ou completo vale', async () => {
    await expect(criar({ aprovado: true })).rejects.toBeDefined();
    for (const falta of ['arquivoRef', 'arquivoMime', 'largura', 'altura', 'tamanhoKb', 'arquivoSha256', 'textoAlternativo', 'destinoUrl'] as const) {
      await expect(criar({ aprovado: true, ...COMPLETO, [falta]: null }), falta).rejects.toBeDefined();
    }
    await criar({ aprovado: true, ...COMPLETO });
    await criar({ aprovado: false });
    await criar({ aprovado: false, ...COMPLETO });
  });

  it('arquivo coerente (tudo ou nada), tipo só JPEG/PNG/GIF, dimensões e peso positivos, hash de 64 hex minúsculos, texto alternativo de 1 a 200', async () => {
    const ruins: Array<Record<string, unknown>> = [
      { arquivoMime: 'image/webp' }, { arquivoMime: 'text/html' }, { largura: 0 }, { altura: -1 }, { tamanhoKb: 0 },
      { arquivoSha256: 'C'.repeat(64) }, { arquivoSha256: 'c'.repeat(63) }, { arquivoSha256: 'z'.repeat(64) },
      { textoAlternativo: '' }, { textoAlternativo: '   ' }, { textoAlternativo: 'a'.repeat(201) }, { destinoUrl: 'http://sem-https.example' },
    ];
    for (const r of ruins) await expect(criar({ aprovado: false, ...COMPLETO, ...r }), JSON.stringify(r)).rejects.toBeDefined();
    // só parte do arquivo (mime sem o resto) viola a coerência
    await expect(criar({ aprovado: false, arquivoMime: 'image/png' })).rejects.toBeDefined();
    // a chave sozinha (sem medição) é só rascunho: o CHECK de coerência não a recusa, mas a APROVAÇÃO exige tudo (testado acima)
    await expect(criar({ aprovado: false, arquivoRef: 'anuncios/x.png' })).resolves.toBeDefined();
  });
});

describe('migração 0023: descer e subir de novo', () => {
  it('o down remove colunas e CHECKs e o registro da migração; o up revoga a aprovação de criativo antigo (sem arquivo) e volta a valer o CHECK', async () => {
    await app.t.client.exec(DOWN);
    const cols = async () => (await app.t.client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ad_creatives' AND column_name IN ('arquivo_mime','largura','altura','tamanho_kb','arquivo_sha256','texto_alternativo') ORDER BY 1`)).rows.map((r) => r.column_name);
    expect(await cols()).toEqual([]);
    // criativo APROVADO de antes de existir o arquivo (o esquema antigo permitia)
    await app.t.client.exec(`INSERT INTO ad_creatives (id, campanha_id, slot_id, peso, inicio, fim, aprovado) VALUES ('cr-antigo', 'cmp-1', 'TOP', 1, '2026-11-01', '2026-12-31', true)`);
    for (const stmt of UP.split('--> statement-breakpoint')) if (stmt.trim()) await app.t.client.exec(stmt);
    expect(await cols()).toEqual(['altura', 'arquivo_mime', 'arquivo_sha256', 'largura', 'tamanho_kb', 'texto_alternativo']);
    const [antigo] = (await app.t.client.query<{ aprovado: boolean }>(`SELECT aprovado FROM ad_creatives WHERE id = 'cr-antigo'`)).rows;
    expect(antigo!.aprovado).toBe(false); // revogada: nada é apagado, só deixa de ser "real"
    await expect(criar({ aprovado: true })).rejects.toBeDefined(); // o CHECK voltou
  });

  it('o down só toca em ad_creatives e no registro desta migração', () => {
    expect(DOWN.replace(/--.*$/gm, '')).not.toMatch(/\bDROP (TABLE|SCHEMA|DATABASE)\b|TRUNCATE/i);
    expect([...DOWN.matchAll(/ALTER TABLE (\w+)/g)].every((m) => m[1] === 'ad_creatives')).toBe(true);
  });
});
