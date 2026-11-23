import { describe, expect, it } from 'vitest';
import { CABECALHO, lerCsv, resumoSemConteudo, validarFolha } from './piloto-importacao';

const cab = CABECALHO.join(',');
const csv = (...linhas: string[]) => [cab, ...linhas].join('\n');

describe('lerCsv', () => {
  it('aspas, aspas duplicadas, vírgula e quebra dentro de aspas; BOM; ponto e vírgula', () => {
    expect(lerCsv('﻿a,b\n"x, y","diz ""oi""\nlinha 2"\n')).toEqual([['a', 'b'], ['x, y', 'diz "oi"\nlinha 2']]);
    expect(lerCsv('a;b;c\r\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
});

describe('validarFolha (contrato piloto-leitura-api.md)', () => {
  it('folha boa: uma leitura por matéria, achados agrupados, matéria sem achado aceita', () => {
    const r = validarFolha(csv(
      'a1,a taxa é de 3%,numero,alta,ev_1,,sim,sim,sim,bloqueado',
      'a1,"Fulano, diretor",nome,media,,confere nome,sim,sim,sim,bloqueado',
      'a4,,,,,,sim,sim,sim,aprovado',
    ));
    expect(r).toMatchObject({ ok: true, invalidas: 0 });
    if (!r.ok) throw new Error('x');
    expect(r.leituras).toEqual([
      { materia: 'a1', veredito: 'bloqueado', checklist: { fatosNasEvidencias: true, tom: true, nadaInventado: true }, achados: [
        { trecho: 'a taxa é de 3%', tipo: 'numero', gravidade: 'alta', evidenciaId: 'ev_1' },
        { trecho: 'Fulano, diretor', tipo: 'nome', gravidade: 'media', nota: 'confere nome' },
      ] },
      { materia: 'a4', veredito: 'aprovado', checklist: { fatosNasEvidencias: true, tom: true, nadaInventado: true }, achados: [] },
    ]);
  });
  it('recusa com motivo: matéria fora de a1/a4/a6/a9, trecho curto, tipo e gravidade inválidos, checklist ilegível', () => {
    const r = validarFolha(csv(
      'a2,algo,numero,alta,,,sim,sim,sim,bloqueado',
      'a6,ab,numero,alta,,,sim,sim,sim,bloqueado',
      'a9,trecho ok,causa_efeito,media,,,sim,sim,sim,bloqueado',
    ));
    if (!r.ok) throw new Error('x');
    expect(r.leituras).toEqual([]);
    expect(r.linhas.map((l) => l.motivo)).toEqual([expect.stringMatching(/a1, a4, a6 e a9/), expect.stringMatching(/3 a 500/), expect.stringMatching(/tipo inválido/)]);
  });
  it('"aprovado" com alta ou checklist incompleto é recusado (regra do servidor)', () => {
    const r = validarFolha(csv('a1,valor errado,valor,alta,,,sim,sim,sim,aprovado', 'a4,,,,,,sim,nao,sim,aprovado'));
    if (!r.ok) throw new Error('x');
    expect(r.leituras).toEqual([]);
    expect(r.invalidas).toBe(2);
  });
  it('matéria com uma linha ruim não entra; as outras matérias entram', () => {
    const r = validarFolha(csv('a1,trecho bom,nome,media,,,sim,sim,sim,bloqueado', 'a1,x,nome,media,,,sim,sim,sim,bloqueado', 'a4,,,,,,sim,sim,sim,aprovado'));
    if (!r.ok) throw new Error('x');
    expect(r.leituras.map((l) => l.materia)).toEqual(['a4']);
    expect(r.linhas[0]).toMatchObject({ ok: false, motivo: expect.stringMatching(/outra linha/) });
  });
  it('checklist ou veredito diferentes entre linhas da mesma matéria: recusa', () => {
    const r = validarFolha(csv('a1,trecho um,nome,media,,,sim,sim,sim,bloqueado', 'a1,trecho dois,nome,media,,,sim,sim,sim,aprovado'));
    if (!r.ok) throw new Error('x');
    expect(r.leituras).toEqual([]);
  });
  it('cabeçalho errado ou arquivo vazio: erro do arquivo inteiro', () => {
    expect(validarFolha('materia,trecho\na1,x')).toMatchObject({ ok: false, erro: expect.stringMatching(/Cabeçalho/) });
    expect(validarFolha(cab)).toMatchObject({ ok: false });
  });
});

describe('resumoSemConteudo (cegueira)', () => {
  it('diz matérias, linhas e motivos, nunca o trecho nem a nota', () => {
    const r = validarFolha(csv('a1,SEGREDO DO TRECHO,numero,alta,,NOTA SECRETA,sim,sim,sim,bloqueado', 'a4,ab,nome,media,,,sim,sim,sim,bloqueado'));
    if (!r.ok) throw new Error('x');
    const s = resumoSemConteudo(r);
    expect(s).toContain('a1: 1 linha(s)');
    expect(s).toContain('linha 3 (a4): trecho de 3 a 500 caracteres');
    expect(s).not.toContain('SEGREDO');
    expect(s).not.toContain('NOTA SECRETA');
  });
});