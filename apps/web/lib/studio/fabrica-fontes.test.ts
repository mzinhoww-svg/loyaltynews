import { describe, expect, it } from 'vitest';
import { elegiveisParaLote, explicarRecusa, filtrarFontes, filtroEstado, resumoDoLote, type FonteFabrica } from './fabrica-fontes';

const f = (id: string, extra: Partial<FonteFabrica> = {}): FonteFabrica => ({
  id, nome: `Fonte ${id}`, kind: 'blog', host: `${id}.exemplo.test`, editorias: ['pontos'], termsUrl: null, pesquisa: { nivel: 'lido', pesquisadoPor: 'p', trechoTermos: null },
  habilitada: false, termsStatus: 'pending', urlVerificada: false, paywall: 'unknown', elegivel: false, motivosInelegivel: [], riscos: [], revisao: null, ...extra,
});

describe('explicarRecusa: toda recusa mostra o motivo e o que fazer', () => {
  it('o texto do Backend vem primeiro, sem esconder nada, e termina com "O que fazer"', () => {
    for (const msg of [
      'sem revisão registrada: revise a fonte antes de habilitar',
      'revisão vencida: a definição da fonte mudou desde a revisão',
      'o revisor precisa ser diferente do pesquisador',
      'fonte via provedor: a nota da revisão precisa citar a DP-31 ou a DP-32 (risco aceito pelo proprietário)',
      'fonte inacessível na pesquisa: não aprovável',
      'aprovação exige URL verificada e robots.txt conferido',
      'fonte com login/paywall não pode ser aprovada',
      'a fonte tem aviso de segurança (exige login): confirme para habilitar mesmo assim',
      'entrada inválida termsNote: String must contain at least 20 character(s)',
      'qualquer outra recusa nova',
    ]) {
      const t = explicarRecusa(409, msg);
      expect(t.startsWith(msg.replace(/[.\s]+$/, '')), msg).toBe(true);
      expect(t, msg).toMatch(/\. O que fazer: .{10,}/);
      expect(t, msg).not.toMatch(/\.\./);
    }
  });

  it('orientações específicas', () => {
    expect(explicarRecusa(409, 'sem revisão registrada: revise a fonte antes de habilitar')).toMatch(/administrador para habilitar direto/);
    expect(explicarRecusa(409, 'a fonte tem aviso de segurança (x): confirme para habilitar mesmo assim')).toMatch(/marque “Entendi o aviso de segurança”/);
    expect(explicarRecusa(409, 'fonte via provedor: a nota da revisão precisa citar a DP-31 ou a DP-32')).toMatch(/provedor tarifado/);
    expect(explicarRecusa(403, 'papel sem permissão')).toMatch(/peça a um administrador/);
  });

  it('inelegível traz os motivos do cadastro em português', () => {
    const t = explicarRecusa(409, 'fonte inelegível', { reasons: ['robots_not_respected', 'shared_host_needs_path_prefix', 'algo_novo'] });
    expect(t).toMatch(/não respeita o robots\.txt/);
    expect(t).toMatch(/prefixo de caminho/);
    expect(t).toMatch(/algo_novo/); // motivo desconhecido aparece cru, nunca some
    expect(t).toMatch(/não é de termos/);
  });
});

describe('lista, filtro e lote', () => {
  const todas = [f('a'), f('b', { habilitada: true }), f('c', { riscos: ['exige login'] }), f('d', { riscos: ['acesso via provedor tarifado (DP-31/DP-32)'] })];
  it('"só desabilitadas" e a busca por nome ou host', () => {
    expect(filtrarFontes(todas, '', 'desabilitadas').map((x) => x.id)).toEqual(['a', 'c', 'd']);
    expect(filtrarFontes(todas, '', 'habilitadas').map((x) => x.id)).toEqual(['b']);
    expect(filtrarFontes(todas, 'FONTE C', '').map((x) => x.id)).toEqual(['c']);
    expect(filtrarFontes(todas, 'd.exemplo', 'desabilitadas').map((x) => x.id)).toEqual(['d']);
    expect(filtroEstado('qualquer')).toBe('');
    expect(filtroEstado('desabilitadas')).toBe('desabilitadas');
  });
  it('o lote só pega desabilitadas SEM aviso (via provedor e login ficam para confirmar uma a uma)', () => {
    expect(elegiveisParaLote(todas).map((x) => x.id)).toEqual(['a']);
  });
  it('resumo do lote', () => {
    expect(resumoDoLote({ habilitadas: 3, comAviso: 0, recusadas: 0 })).toBe('3 habilitada(s).');
    expect(resumoDoLote({ habilitadas: 2, comAviso: 1, recusadas: 1 })).toMatch(/2 habilitada\(s\); 1 com aviso de segurança.*; 1 recusada\(s\)/);
  });
});
