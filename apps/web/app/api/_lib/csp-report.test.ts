import { describe, expect, it } from 'vitest';
import { MAX_BYTES, MAX_LINHAS_POR_MINUTO, MAX_RELATOS, criarColetorCsp, extrairViolacoes } from './csp-report';

const antigo = {
  'csp-report': {
    'document-uri': 'https://www.example.test/studio/redefinir?token=SEGREDO#frag',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://user:senha@mau.example/x.js?k=SEGREDO',
    'script-sample': 'SEGREDO',
    'original-policy': 'default-src',
    disposition: 'enforce',
    'source-file': 'https://www.example.test/a.js?v=1',
    'line-number': 7,
  },
};
const post = (corpo: string, tipo = 'application/csp-report', extra: Record<string, string> = {}) =>
  new Request('https://www.example.test/api/csp-report', { method: 'POST', body: corpo, headers: { 'content-type': tipo, ...extra } });

describe('coletor de relatórios CSP', () => {
  it('report-uri: registra diretiva e URLs sem consulta, fragmento, credencial nem amostra de script', async () => {
    const linhas: string[] = [];
    const r = await criarColetorCsp({ log: (l) => linhas.push(l) })(post(JSON.stringify(antigo), 'application/csp-report', { cookie: 'sessao=SEGREDO' }));
    expect(r.status).toBe(204);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).not.toMatch(/SEGREDO|senha|frag|default-src/);
    expect(JSON.parse(linhas[0]!)).toEqual({
      evt: 'csp_violacao',
      diretiva: 'script-src-elem',
      bloqueado: 'https://mau.example/x.js',
      documento: 'https://www.example.test/studio/redefinir',
      disposicao: 'enforce',
      fonte: 'https://www.example.test/a.js',
      linha: 7,
    });
  });

  it('Reporting API: só itens csp-violation, no máximo 10', () => {
    const item = { type: 'csp-violation', body: { documentURL: 'https://a.test/', effectiveDirective: 'script-src', blockedURL: 'inline', disposition: 'report' } };
    const v = extrairViolacoes([{ type: 'deprecation', body: {} }, item, item]);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ diretiva: 'script-src', bloqueado: 'inline', disposicao: 'report' });
    expect(extrairViolacoes(Array(50).fill(item))).toHaveLength(MAX_RELATOS);
  });

  it('lixo não vira linha de log; texto com quebra de linha não forja outra linha', () => {
    for (const x of [null, 1, 'x', {}, [], { 'csp-report': { 'effective-directive': 'a\n{"evt":"forjado"}' } }]) {
      for (const v of extrairViolacoes(x)) expect(JSON.stringify(v)).not.toContain('forjado');
    }
    expect(extrairViolacoes({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'data:image/png;base64,AAAA' } })[0]!.bloqueado).toBe('data:');
  });

  it('recusa tipo errado (415), JSON inválido (400) e corpo grande (413), sem registrar', async () => {
    const linhas: string[] = [];
    const c = criarColetorCsp({ log: (l) => linhas.push(l) });
    expect((await c(post('{}', 'text/plain'))).status).toBe(415);
    expect((await c(post('{'))).status).toBe(400);
    expect((await c(post(JSON.stringify({ x: 'a'.repeat(MAX_BYTES) })))).status).toBe(413);
    expect(linhas).toHaveLength(0);
  });

  it('teto de linhas por minuto, que zera na janela seguinte', async () => {
    const linhas: string[] = [];
    let t = 0;
    const c = criarColetorCsp({ log: (l) => linhas.push(l), agora: () => t });
    for (let i = 0; i < MAX_LINHAS_POR_MINUTO + 5; i++) await c(post(JSON.stringify(antigo)));
    expect(linhas).toHaveLength(MAX_LINHAS_POR_MINUTO);
    t = 60_000;
    await c(post(JSON.stringify(antigo)));
    expect(linhas).toHaveLength(MAX_LINHAS_POR_MINUTO + 1);
  });
});
