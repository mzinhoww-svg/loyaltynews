import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESTADOS_DA_FABRICA, vazioDaFabrica } from './checagem-vazio';

describe('fila da Fábrica sem itens', () => {
  it.each(ESTADOS_DA_FABRICA.map((e) => [e.valor, e.rotulo]))('filtro %s: fala só desse estado, nunca que a Fábrica não entregou nada', (valor, rotulo) => {
    const v = vazioDaFabrica(valor!);
    expect(v.filtrado).toBe(true);
    expect(v.titulo).toBe('Nenhuma matéria da Fábrica com esse estado');
    expect(v.descricao).toContain(`“${rotulo}”`);
    expect(v.descricao).toContain('“Todos”');
    expect(`${v.titulo} ${v.descricao}`).not.toMatch(/não entregou|desligadas|nada chega/);
  });

  it('filtro fora da lista (publicado) também é tratado como filtro', () => {
    const v = vazioDaFabrica('publicado');
    expect(v.filtrado).toBe(true);
    expect(v.descricao).toContain('“publicado”');
    expect(v.descricao).not.toContain('não entregou');
  });

  it('sem filtro: diz por que está vazia e não promete que o envio pelo CMS alimenta esta fila', () => {
    const v = vazioDaFabrica('');
    expect(v.filtrado).toBe(false);
    expect(v.titulo).toBe('Nenhuma matéria da Fábrica na fila');
    expect(v.descricao).toContain('não entregou rascunho nenhum');
    expect(v.descricao).toContain('Matéria enviada para checagem no CMS aparece na seção “Matérias do CMS em checagem”');
    expect(v.descricao).not.toMatch(/enviar uma matéria para checagem/);
  });

  it('a tela usa esta regra e oferece limpar o filtro', () => {
    const src = readFileSync(join(__dirname, '../../../app/studio/(protegido)/cms/checagem/page.tsx'), 'utf8');
    expect(src).toContain('vazioDaFabrica(status)');
    expect(src).toContain('data-limpar-filtro');
  });
});
