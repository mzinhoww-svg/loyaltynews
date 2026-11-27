import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INFO_DOCS } from '../app/(portal)/_lib/institutional';

// N1 (auditoria de estado honesto do portal, 26/11): /correcoes é texto fixo e não lê as matérias; não pode afirmar quantas existem
// nem quantas foram corrigidas. Texto aprovado pela Editorial.
const historico = INFO_DOCS['correcoes']!.sections.find((s) => s.heading === 'Histórico de correções')!;
const afirmaVazio = /n[ãa]o publicou|n[ãa]o h[áa] corre[çc][õo]es|nenhuma corre[çc][ãa]o|ainda n[ãa]o/i;

describe('/correcoes: histórico de correções', () => {
  it('não afirma que o portal não publicou matérias nem que não há correções', () => {
    expect(historico.paragraphs!.join(' ')).not.toMatch(afirmaVazio);
  });

  it('diz onde a correção fica, com o texto aprovado', () => {
    expect(historico.paragraphs).toEqual([
      'Cada correção fica registrada na própria matéria corrigida, no aviso “Matéria corrigida” e no histórico ao fim do texto, com a data e a descrição do que mudou.',
    ]);
  });

  it('o que o texto promete existe na página da matéria: aviso, histórico ao fim, data e descrição', () => {
    const materia = readFileSync(fileURLToPath(new URL('../app/(portal)/noticia/[slug]/page.tsx', import.meta.url)), 'utf8');
    const aviso = materia.indexOf('Matéria corrigida');
    const fim = materia.indexOf('Histórico de correções');
    expect(aviso).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(aviso);
    for (const trecho of [materia.slice(aviso, fim), materia.slice(fim)]) expect(trecho).toMatch(/formatDate\(c\.at\)[^]*c\.text/);
  });

  it('controle negativo: a regra reprova a frase antiga e não reprova o texto sobre como corrigimos', () => {
    expect('Ainda não há correções registradas: o portal não publicou matérias.').toMatch(afirmaVazio);
    expect(INFO_DOCS['correcoes']!.sections[0]!.paragraphs!.join(' ')).not.toMatch(afirmaVazio);
  });
});
