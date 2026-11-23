import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonLdString } from '../app/(portal)/_lib/jsonld';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

describe('jsonLdString (XSS no JSON-LD, reprovação do QA 4 em 4bc0f69)', () => {
  const hostil = { headline: '</script><script>alert(1)</script>', desc: 'a & b < c > d', ls: `x${LS}y${PS}z`, nested: { t: ['</SCRIPT>', '<!--', '-->'] } };

  it('controle positivo: JSON.stringify cru deixa passar </script> (é o defeito que a função corrige)', () => {
    expect(JSON.stringify(hostil)).toContain('</script>');
  });
  it('a saída não contém <, >, & nem U+2028/2029: nada fecha o bloco <script>', () => {
    const out = jsonLdString(hostil);
    for (const bad of ['<', '>', '&', LS, PS]) expect(out.includes(bad), JSON.stringify(bad)).toBe(false);
    expect(out.toLowerCase()).not.toContain('</script');
  });
  it('continua JSON válido e o valor lido é idêntico ao original', () => {
    expect(JSON.parse(jsonLdString(hostil))).toEqual(hostil);
    expect(JSON.parse(jsonLdString({ a: 1, b: [true, null], c: 'ç ã é' }))).toEqual({ a: 1, b: [true, null], c: 'ç ã é' });
  });
  it('escapa em qualquer posição (chave, valor, aninhado)', () => {
    const out = jsonLdString({ '</script>': ['<img src=x onerror=alert(1)>'] });
    expect(out).not.toMatch(/[<>&]/);
    expect(JSON.parse(out)).toEqual({ '</script>': ['<img src=x onerror=alert(1)>'] });
  });
});

/** Trava estática: nenhuma página do app pode serializar JSON-LD (ou qualquer JSON) cru para dentro de dangerouslySetInnerHTML. */
describe('nenhum JSON.stringify cru em dangerouslySetInnerHTML', () => {
  const root = join(__dirname, '..', 'app');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.(tsx|ts)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
  const offenders = walk(root).flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f, i: i + 1, l }))).filter(({ l }) => l.includes('dangerouslySetInnerHTML') && /JSON\.stringify/.test(l));

  it('o app tem blocos JSON-LD (a trava não está vazia) e todos passam por jsonLdString', () => {
    const ld = walk(root).flatMap((f) => readFileSync(f, 'utf8').split('\n')).filter((l) => l.includes('<script type="application/ld+json"') && l.includes('dangerouslySetInnerHTML'));
    expect(ld.length).toBeGreaterThanOrEqual(3);
    for (const l of ld) expect(l, l.trim()).toContain('jsonLdString(');
  });
  it('nenhuma linha usa JSON.stringify direto em dangerouslySetInnerHTML', () => {
    expect(offenders.map((o) => `${o.f}:${o.i}`)).toEqual([]);
  });
});
