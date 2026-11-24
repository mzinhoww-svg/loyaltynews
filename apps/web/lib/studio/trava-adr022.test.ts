import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Trava estática da ADR-022 no Studio: telas e bibliotecas do Studio leem flag SÓ por `flagAtiva` (lib/studio/flags.ts, que usa o resolvedor de
// runtime e, no build de e2e, as flags de teste). Chamar `isEnabled(...)` direto (ou importá-lo) lê o estado do processo da API e escapa do
// resolvedor: em produção a tela e a API poderiam divergir. Este teste varre `app/studio` e `lib/studio` e reprova qualquer uso fora de
// `lib/studio/flags.ts`. Arquivos de teste (*.test.ts[x]) e os comentários não contam.

const APP = join(__dirname, '../..');
const RAIZES = [join(APP, 'app/studio'), join(APP, 'lib/studio')];
const PERMITIDOS = [join(APP, 'lib/studio/flags.ts')];

/** Tira comentários de linha e de bloco (o texto da ADR cita o nome sem usá-lo). Não é um parser: basta para esta varredura. */
const semComentarios = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Uso real: chamada `isEnabled(`, ou importação com esse nome (`import { isEnabled } from ...`, `import { x as isEnabled }`). */
const USO = /\bisEnabled\s*\(|\bimport\b[^;]*\{[^}]*\bisEnabled\b[^}]*\}[^;]*from/;

export function acharIsEnabled(raizes: string[], permitidos: string[]): string[] {
  const achados: string[] = [];
  const varre = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      if (nome === 'node_modules' || nome === '.next') continue;
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) varre(p);
      else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.(ts|tsx)$/.test(nome) && !permitidos.includes(p) && USO.test(semComentarios(readFileSync(p, 'utf8')))) achados.push(p);
    }
  };
  for (const r of raizes) varre(r);
  return achados.map((p) => relative(APP, p).split(sep).join('/'));
}

describe('trava ADR-022: o Studio não lê flag por isEnabled', () => {
  it('na árvore real (app/studio e lib/studio) não há uso fora de lib/studio/flags.ts', () => {
    expect(acharIsEnabled(RAIZES, PERMITIDOS)).toEqual([]);
  });

  it('a varredura enxerga o que deve reprovar (ocorrência plantada em pasta temporária)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'trava-adr022-'));
    try {
      mkdirSync(join(tmp, 'app/studio/(protegido)/social'), { recursive: true });
      mkdirSync(join(tmp, 'lib/studio'), { recursive: true });
      // reprovam
      writeFileSync(join(tmp, 'app/studio/(protegido)/social/page.tsx'), "import { isEnabled } from '@/app/api/_lib/flags';\nexport default () => (isEnabled('instagram') ? 1 : 0);\n");
      writeFileSync(join(tmp, 'lib/studio/atalho.ts'), "export const ligado = () => isEnabled('rituais');\n");
      writeFileSync(join(tmp, 'lib/studio/apelido.ts'), "import { outra as isEnabled } from '../x';\nexport const a = 1;\n");
      // não reprovam: flagAtiva, comentário que só cita o nome, teste, e o arquivo permitido
      writeFileSync(join(tmp, 'lib/studio/ok.ts'), "import { flagAtiva } from './flags';\n// nunca por isEnabled(...) direto\n/* isEnabled('x') em bloco */\nexport const b = flagAtiva('rituais');\n");
      writeFileSync(join(tmp, 'lib/studio/coisa.test.ts'), "expect(isEnabled('x')).toBe(true);\n");
      writeFileSync(join(tmp, 'lib/studio/flags.ts'), "export const x = isEnabled('permitido aqui');\n");
      const achados = acharIsEnabled([join(tmp, 'app/studio'), join(tmp, 'lib/studio')], [join(tmp, 'lib/studio/flags.ts')]).map((p) => p.replace(/^.*?(app\/studio|lib\/studio)/, '$1'));
      // os caminhos saem relativos a APP; o prefixo temporário varia, então confere pelos sufixos
      expect(achados.some((p) => p.endsWith('app/studio/(protegido)/social/page.tsx'))).toBe(true);
      expect(achados.some((p) => p.endsWith('lib/studio/atalho.ts'))).toBe(true);
      expect(achados.some((p) => p.endsWith('lib/studio/apelido.ts'))).toBe(true);
      expect(achados.some((p) => /ok\.ts$|coisa\.test\.ts$|\/flags\.ts$/.test(p))).toBe(false);
      expect(achados).toHaveLength(3);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
