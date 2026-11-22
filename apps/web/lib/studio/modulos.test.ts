import { describe, expect, it } from 'vitest';
import { FontesService, type FonteInput } from './fontes';
import { MidiaService, estadoDeUso, type MidiaInput } from './midia';
import { AgendaService, hojeSP, type EventoInput } from './agenda';
import { HomeService, alternarBloco, alternarMenu, configPadrao, moverBloco, moverMenu, validarHome } from './home';
import { SeoService, rotasCanonicas } from './seo';

let n = 0;
const relogio = () => ({ agora: () => new Date(Date.UTC(2026, 10, 22, 12, 0, n++)).toISOString(), id: () => `id-${n++}` });

const fonte: FonteInput = { nome: 'Comunicado Programa X', url: 'https://exemplo.com.br/imprensa', tipo: 'comunicado', editorias: ['pontos'], termosRevisados: true, ativo: true };

describe('fontes', () => {
  it('cria fonte válida e registra auditoria', () => {
    const s = new FontesService(relogio());
    const r = s.criar('ana', fonte);
    expect(r.ok).toBe(true);
    expect(s.list()).toHaveLength(1);
    expect(s.trilha[0]).toMatchObject({ quem: 'ana', acao: 'fonte_criada' });
  });
  it('ativa só com termos revisados, exige URL, tipo e editoria', () => {
    const s = new FontesService(relogio());
    expect(s.criar('ana', { ...fonte, termosRevisados: false })).toMatchObject({ ok: false });
    expect(s.criar('ana', { ...fonte, url: 'ftp://x' })).toMatchObject({ ok: false });
    expect(s.criar('ana', { ...fonte, editorias: [] })).toMatchObject({ ok: false });
    expect(s.criar('ana', { ...fonte, editorias: ['inexistente'] })).toMatchObject({ ok: false });
    expect(s.criar('ana', { ...fonte, tipo: 'login' })).toMatchObject({ ok: false });
    expect(s.criar('ana', { ...fonte, termosRevisados: false, ativo: false }).ok).toBe(true);
  });
  it('rejeita URL duplicada (normalizada) e alterna ativo respeitando termos', () => {
    const s = new FontesService(relogio());
    const a = s.criar('ana', { ...fonte, termosRevisados: false, ativo: false });
    if (!a.ok) throw new Error('criar');
    expect(s.criar('ana', { ...fonte, url: 'https://EXEMPLO.com.br/imprensa/#x' })).toMatchObject({ ok: false, erros: ['Já existe uma fonte com esta URL.'] });
    expect(s.alternarAtivo('ana', a.valor.id)).toMatchObject({ ok: false });
    expect(s.atualizar('ana', a.valor.id, { ...fonte, ativo: true }).ok).toBe(true);
    expect(s.alternarAtivo('ana', a.valor.id)).toMatchObject({ ok: true, valor: { ativo: false } });
  });
});

const img: MidiaInput = { url: 'https://exemplo.com.br/a.jpg', origem: 'licenciada', credito: 'Agência', baseDeDireito: 'licenca', textoAlternativo: 'Descrição', evidenciaLicenca: 'contrato-123' };

describe('mídia', () => {
  it('registra ativo com direito e evidência; duplicata e direito de terceiro sem evidência falham', () => {
    const s = new MidiaService(relogio());
    expect(s.registrar('ana', img).ok).toBe(true);
    expect(s.registrar('ana', img)).toMatchObject({ ok: false });
    expect(s.registrar('ana', { ...img, url: 'https://exemplo.com.br/b.jpg', evidenciaLicenca: '' })).toMatchObject({ ok: false });
    expect(s.registrar('ana', { ...img, url: 'https://exemplo.com.br/c.jpg', textoAlternativo: '' })).toMatchObject({ ok: false });
    expect(s.registrar('ana', { ...img, url: 'https://exemplo.com.br/d.jpg', origem: 'fonte_terceiro' })).toMatchObject({ ok: false });
  });
  it('estado de uso: pendente, expirada, utilizável', () => {
    expect(estadoDeUso({ ...img, baseDeDireito: 'pendente' }, '2026-11-22')).toBe('direito_pendente');
    expect(estadoDeUso({ ...img, expiraEm: '2026-11-21' }, '2026-11-22')).toBe('expirada');
    expect(estadoDeUso({ ...img, expiraEm: '2026-11-22' }, '2026-11-22')).toBe('utilizavel');
    expect(estadoDeUso(img, '2026-11-22')).toBe('utilizavel');
  });
  it('remove e audita', () => {
    const s = new MidiaService(relogio());
    const r = s.registrar('ana', img);
    if (!r.ok) throw new Error('registrar');
    expect(s.remover('rui', r.valor.id).ok).toBe(true);
    expect(s.list()).toEqual([]);
    expect(s.trilha.map((t) => t.acao)).toEqual(['midia_registrada', 'midia_removida']);
  });
});

const ev: EventoInput = { titulo: 'Congresso de Fidelização', inicio: '2026-12-01', fim: '2026-12-02', local: 'São Paulo', editorias: ['mercado'], patrocinado: false, fonteUrl: 'https://congresso.exemplo.com.br' };

describe('agenda', () => {
  it('evento só com fonte oficial, datas coerentes e moderação com motivo', () => {
    const s = new AgendaService(relogio());
    expect(s.criar('ana', { ...ev, fonteUrl: '' })).toMatchObject({ ok: false });
    expect(s.criar('ana', { ...ev, fim: '2026-11-30' })).toMatchObject({ ok: false });
    const c = s.criar('ana', ev);
    if (!c.ok) throw new Error('criar');
    expect(c.valor.moderacao).toBe('pendente');
    expect(s.moderar('rui', c.valor.id, 'rejeitado', ' ')).toMatchObject({ ok: false });
    expect(s.moderar('rui', c.valor.id, 'aprovado')).toMatchObject({ ok: true, valor: { moderacao: 'aprovado' } });
  });
  it('evento passado sai da lista de próximos', () => {
    const s = new AgendaService(relogio());
    s.criar('ana', { ...ev, titulo: 'Passado', inicio: '2026-11-01', fim: '2026-11-02' });
    s.criar('ana', { ...ev, titulo: 'Em curso', inicio: '2026-11-20', fim: '2026-11-22' });
    s.criar('ana', ev);
    expect(s.proximos('2026-11-22').map((e) => e.titulo)).toEqual(['Em curso', 'Congresso de Fidelização']);
    expect(s.passados('2026-11-22').map((e) => e.titulo)).toEqual(['Passado']);
    expect(hojeSP(new Date('2026-11-22T02:00:00Z'))).toBe('2026-11-21');
  });
});

describe('home e menus', () => {
  it('padrão segue a ordem 0–12 do blueprint e é válido', () => {
    const c = configPadrao();
    expect(c.blocos.map((b) => b.id)).toEqual(['ticker', 'header', 'banner-topo', 'destaques', 'em-alta', 'mercado', 'agenda', 'ultimas', 'the-loyal', 'editorias', 'banner-rodape', 'captura', 'footer']);
    expect(validarHome(c)).toEqual([]);
    expect(c.blocos.find((b) => b.id === 'banner-topo')?.dimensao).toBe('1280×150');
  });
  it('não move blocos fixos nem esconde header/footer; banner escondido mantém dimensão reservada', () => {
    let c = configPadrao();
    expect(moverBloco(c, 'header', 1)).toBe(c);
    expect(moverBloco(c, 'destaques', -1).blocos.map((b) => b.id).slice(2, 4)).toEqual(['destaques', 'banner-topo']);
    expect(moverBloco(c, 'captura', 1)).toBe(c); // footer é fixo
    c = alternarBloco(c, 'footer');
    expect(c.blocos.find((b) => b.id === 'footer')?.visivel).toBe(true);
    c = alternarBloco(c, 'banner-topo');
    expect(c.blocos.find((b) => b.id === 'banner-topo')).toMatchObject({ visivel: false, dimensao: '1280×150' });
    expect(validarHome(c)).toEqual([]);
  });
  it('rejeita footer fora do fim, dimensão alterada e menu com flag desligada visível', () => {
    const c = configPadrao();
    const sem = { ...c, blocos: [...c.blocos].reverse() };
    expect(validarHome(sem).length).toBeGreaterThan(0);
    const dim = { ...c, blocos: c.blocos.map((b) => (b.id === 'banner-topo' ? { ...b, dimensao: '1x1' } : b)) };
    expect(validarHome(dim).join(' ')).toContain('dimensão reservada');
    expect(validarHome(alternarMenu(c, 'market-data')).join(' ')).toContain('portalMarketData');
    expect(validarHome(alternarMenu(c, 'market-data'), { portalMarketData: true })).toEqual([]);
  });
  it('salvar e reverter criam versões, nunca sobrescrevem', () => {
    const s = new HomeService(relogio());
    const alterada = moverMenu(configPadrao(), 'contato', -1);
    const v2 = s.salvar('ana', alterada, 'menu');
    expect(v2).toMatchObject({ ok: true, valor: { numero: 2 } });
    const v3 = s.reverter('ana', 1);
    expect(v3).toMatchObject({ ok: true, valor: { numero: 3, nota: 'rollback para v1' } });
    expect(s.versoes).toHaveLength(3);
    expect(s.versoes[1]!.config.menu.map((m) => m.id).at(-2)).toBe('contato');
    expect(s.vigente().config.menu.at(-1)?.id).toBe('contato');
    expect(s.reverter('ana', 99)).toMatchObject({ ok: false });
  });
});

describe('seo', () => {
  it('cria redirecionamento válido e audita', () => {
    const s = new SeoService(relogio());
    expect(s.criar('ana', '/noticia-antiga/', '/noticia/nova', 301)).toMatchObject({ ok: true, valor: { de: '/noticia-antiga', codigo: 301 } });
    expect(s.trilha[0]).toMatchObject({ quem: 'ana', acao: 'redirect_criado' });
  });
  it('rejeita domínio, igual, rota canônica, duplicata, código inválido e ciclo', () => {
    const s = new SeoService(relogio());
    expect(s.criar('ana', 'https://x.com/a', '/b', 301)).toMatchObject({ ok: false });
    expect(s.criar('ana', '/a', '/a', 301)).toMatchObject({ ok: false });
    expect(s.criar('ana', '/editoria/pontos', '/b', 301)).toMatchObject({ ok: false });
    expect(s.criar('ana', '/a', '/b', 200)).toMatchObject({ ok: false });
    expect(s.criar('ana', '/a', '/b', 301).ok).toBe(true);
    expect(s.criar('ana', '/a', '/c', 301)).toMatchObject({ ok: false });
    expect(s.criar('ana', '/b', '/a', 301)).toMatchObject({ ok: false });
    expect(s.criar('ana', '/b', '/c', 302).ok).toBe(true);
    expect(s.criar('ana', '/c', '/a', 301)).toMatchObject({ ok: false });
    expect(s.cadeias()).toEqual(['/a → /b → /c']);
  });
  it('rotas canônicas incluem as dez editorias', () => {
    expect(rotasCanonicas().filter((r) => r.startsWith('/editoria/'))).toHaveLength(10);
  });
});
