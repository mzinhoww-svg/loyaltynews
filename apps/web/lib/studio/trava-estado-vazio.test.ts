import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Refino do lançamento, pacote C item 5: os estados vazio, indisponível e erro das telas do Studio 1 usam o EmptyState do design system.
// Esta trava impede a volta da caixa improvisada (className="st-empty") e do bloco de erro de carga feito à mão nessas telas.
const APP = join(__dirname, '../../app/studio');
const TELAS = [
  '_components/SemBanco.tsx',
  '(protegido)/[modulo]/page.tsx',
  '(protegido)/cms/page.tsx',
  '(protegido)/cms/checagem/page.tsx',
  '(protegido)/cms/correcoes/page.tsx',
  '(protegido)/cms/pautas/page.tsx',
  '(protegido)/agenda/page.tsx',
  '(protegido)/fontes/page.tsx',
  '(protegido)/fontes/fabrica/page.tsx',
  '(protegido)/midia/page.tsx',
  '(protegido)/seo/page.tsx',
  '(protegido)/entidades/page.tsx',
];

describe('estados vazio e erro com o EmptyState do design system', () => {
  for (const arq of TELAS) {
    it(`${arq} não usa a caixa st-empty improvisada`, () => {
      const p = join(APP, arq);
      expect(existsSync(p), arq).toBe(true);
      const src = readFileSync(p, 'utf8');
      expect(src).not.toMatch(/className="st-empty"/);
      expect(src).toMatch(/EmptyState/);
    });
  }
});
