import { describe, expect, it } from 'vitest';
import { eventoVigente, hojeSP } from './datas';
import { HomeService, alternarBloco, alternarMenu, configPadrao, moverBloco, moverMenu, validarHome } from './home';
import { SeoService, rotasCanonicas } from './seo';

let n = 0;
const relogio = () => ({ agora: () => new Date(Date.UTC(2026, 10, 22, 12, 0, n++)).toISOString(), id: () => `id-${n++}` });

describe('datas', () => {
  it('hoje em São Paulo respeita o fuso', () => {
    expect(hojeSP(new Date('2026-11-22T02:00:00Z'))).toBe('2026-11-21');
  });
  it('evento encerrado sai da lista de vigentes', () => {
    expect(eventoVigente('2026-11-22', '2026-11-22')).toBe(true);
    expect(eventoVigente('2026-11-21', '2026-11-22')).toBe(false);
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
