import { describe, expect, it } from 'vitest';
import { antesEDepois, nivelDoCargo, textoDaEvidencia, type EvidenciaRef, type MoveLinha } from './intelligence-view';

const ev = (over: Partial<EvidenciaRef> = {}): EvidenciaRef => ({ id: 'e1', source_url: 'https://ri.exemplo.com.br/a', source_name: 'RI Exemplo', retrieved_at: '2026-11-20T10:00:00.000Z', is_mock: false, ...over });
const move = (over: Partial<MoveLinha> = {}): MoveLinha => ({
  id: 'm1', kind: 'title_change', basis: 'observed_diff', status: 'detected', person_id: 'p1', person_name: 'Ana', from_organization: 'Alfa', from_title: 'Diretora de Marketing',
  to_organization: 'Alfa', to_title: 'Diretora de CRM', effective_date: null, observed_on: '2026-11-05', evidence: ev({ id: 'depois' }), ...over,
});

describe('nivelDoCargo', () => {
  it('declarado é oficial; inferido é secundária e "a confirmar"', () => {
    expect(nivelDoCargo('declared')).toEqual({ chave: 'oficial', rotulo: 'Oficial' });
    expect(nivelDoCargo('inferred')).toEqual({ chave: 'secundaria', rotulo: 'Secundária — a confirmar' });
  });
});

describe('textoDaEvidencia', () => {
  it('fonte e data; MOCK quando é dado de teste; nunca o trecho', () => {
    expect(textoDaEvidencia(ev())).toBe('RI Exemplo · 2026-11-20');
    expect(textoDaEvidencia(ev({ is_mock: true }))).toBe('RI Exemplo · 2026-11-20 · MOCK');
  });
});

describe('antesEDepois', () => {
  it('sem before/after do Backend usa os atalhos e a evidência que detectou o Move no "depois"', () => {
    const [a, d] = antesEDepois(move());
    expect(a).toMatchObject({ rotulo: 'Antes', cargo: { organizacao: 'Alfa', titulo: 'Diretora de Marketing' }, evidencia: null });
    expect(d).toMatchObject({ rotulo: 'Depois', cargo: { titulo: 'Diretora de CRM' } });
    expect(d.evidencia?.id).toBe('depois');
  });
  it('com before/after traz a evidência de cada leitura e a validação', () => {
    const leitura = (titulo: string, id: string) => ({ role_id: 'r', organization: 'Alfa', title: titulo, valid_from: '2026-01-01', valid_to: null, certainty: 'declared' as const, validated_at: '2026-11-01T00:00:00.000Z', evidence: ev({ id }) });
    const [a, d] = antesEDepois(move({ before: leitura('Diretora de Marketing', 'ev-antes'), after: leitura('Diretora de CRM', 'ev-depois') }));
    expect(a.evidencia?.id).toBe('ev-antes');
    expect(d.evidencia?.id).toBe('ev-depois');
    expect(a.validadoEm).toBe('2026-11-01T00:00:00.000Z');
  });
  it('nomeação não tem antes e saída não tem depois: lado inexistente é null, sem inventar', () => {
    const [a] = antesEDepois(move({ kind: 'appointment', from_organization: null, from_title: null }));
    expect(a.cargo).toBeNull();
    const [, d] = antesEDepois(move({ kind: 'departure', to_organization: null, to_title: null, after: null }));
    expect(d.cargo).toBeNull();
  });
});
