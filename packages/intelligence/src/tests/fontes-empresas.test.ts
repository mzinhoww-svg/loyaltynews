import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Row = {
  id: string; nome: string; url: string; estado: string; robots: string | null; http_status: number | null; texto_caracteres: number;
  renderizacao: string | null; sitemaps: string[]; feeds_declarados: string[]; observacao: string;
};
const file = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const CAND = JSON.parse(readFileSync(file('fontes-empresas.candidatos.json'), 'utf8')) as { fontes: { id: string; url: string }[] };
const SONDA = JSON.parse(readFileSync(file('fontes-empresas.candidatos.sonda.json'), 'utf8')) as { regra: string; resumo: Record<string, number>; fontes: Row[] };
const MD = readFileSync(fileURLToPath(new URL('../../fontes-empresas.md', import.meta.url)), 'utf8');

const CLASSE_C = /(voeazul|voegol|abecs|iata\.org|nubank|accor|marriott|salesforce|hubspot|zendesk|oneworld|abav)/i;
const ESTADOS = ['acessivel', 'acessivel_requer_navegador', 'bloqueada_http', 'bloqueada_captcha', 'bloqueada_por_robots', 'robots_inacessivel_nao_buscada', 'indisponivel', 'erro_de_rede', 'nao_sondada_classe_c'];

describe('sonda de fontes de empresas (DP-28/DP-29)', () => {
  it('nenhuma fonte de classe C entre as candidatas; sonda cobre todas as candidatas, na mesma ordem', () => {
    expect(CAND.fontes.some((f) => CLASSE_C.test(f.url))).toBe(false);
    expect(SONDA.fontes.map((r) => r.id)).toEqual(CAND.fontes.map((f) => f.id));
  });

  it('estados válidos; bloqueio nunca vira "acessível"; página só foi buscada se o robots permitiu', () => {
    for (const r of SONDA.fontes) {
      expect(ESTADOS).toContain(r.estado);
      if (r.http_status === 403 || r.http_status === 429) expect(r.estado).toBe('bloqueada_http');
      if (r.estado === 'bloqueada_por_robots' || r.estado === 'robots_inacessivel_nao_buscada') {
        expect(r.http_status).toBeNull(); // não buscada
        expect(r.texto_caracteres).toBe(0);
      }
      if (r.estado.startsWith('acessivel')) {
        expect(r.http_status).toBe(200);
        expect(r.robots).toMatch(/permite|ausente/);
      }
    }
  });

  it('resumo bate com as linhas; a regra de não contornar está registrada no relatório e no documento', () => {
    const count: Record<string, number> = {};
    for (const r of SONDA.fontes) count[r.estado] = (count[r.estado] ?? 0) + 1;
    expect(SONDA.resumo).toEqual(count);
    expect(SONDA.regra).toMatch(/não contornar/);
    expect(MD).toMatch(/não contornar|nunca contornar|sem contornar|não\*\* contornar/i);
    for (const r of SONDA.fontes) expect(MD).toContain(r.nome);
  });

  it('reavaliação das três fontes marcadas como inacessíveis pelo Editorial está no documento com o estado real', () => {
    const by = Object.fromEntries(SONDA.fontes.map((r) => [r.id, r]));
    for (const id of ['livelo-imprensa', 'magalu-ri', 'santander-ri']) {
      expect(by[id]!.estado).toBe('acessivel');
      expect(MD).toContain(by[id]!.nome.split(' — ')[0]!.split(' (')[0]!);
    }
  });
});
