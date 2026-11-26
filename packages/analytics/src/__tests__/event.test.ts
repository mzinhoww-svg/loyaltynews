import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { classifyReferrer, CollectEventSchema, deviceClass, normalizePath } from '../event';

describe('evento estrito (R1-07: nenhum e-mail, nome ou token)', () => {
  const ok = { t: 'pageview', path: '/materia/regra-de-validade', ref: 'https://www.google.com/', w: 390 };

  test('aceita o evento mínimo e os opcionais', () => {
    assert.equal(CollectEventSchema.safeParse(ok).success, true);
    assert.equal(CollectEventSchema.safeParse({ t: 'pageview', path: '/' }).success, true);
  });

  test('recusa QUALQUER campo fora da lista, inclusive os que identificam pessoa ou dispositivo', () => {
    for (const extra of ['email', 'nome', 'name', 'token', 'userId', 'uid', 'cid', 'clientId', 'cookie', 'ip', 'userAgent', 'ua', 'lang', 'screen', 'fingerprint', 'cpf', 'telefone', 'query', 'q', 'hash']) {
      const r = CollectEventSchema.safeParse({ ...ok, [extra]: 'x' });
      assert.equal(r.success, false, extra);
    }
  });

  test('recusa tipo desconhecido, caminho vazio ou longo, largura inválida', () => {
    for (const bad of [{ ...ok, t: 'click' }, { ...ok, path: '' }, { ...ok, path: '/' + 'a'.repeat(400) }, { ...ok, w: 0 }, { ...ok, w: 1.5 }, { ...ok, w: 99999 }, { ...ok, ref: 'x'.repeat(600) }, { t: 'pageview' }, null, 'texto', []]) {
      assert.equal(CollectEventSchema.safeParse(bad).success, false, JSON.stringify(bad)?.slice(0, 40));
    }
  });
});

describe('normalizePath', () => {
  test('descarta query e fragmento mesmo quando vêm no caminho', () => {
    assert.equal(normalizePath('/busca?q=joao.silva@exemplo.com&token=abc#topo'), '/busca');
    assert.equal(normalizePath('/materia/a-b?utm_source=linkedin'), '/materia/a-b');
  });

  test('troca por :id o que parece identificador: e-mail, CPF/telefone, UUID, hexadecimal, token longo', () => {
    assert.equal(normalizePath('/usuario/joao@exemplo.com'), '/usuario/:id');
    assert.equal(normalizePath('/usuario/joao%40exemplo.com'), '/usuario/:id');
    assert.equal(normalizePath('/cliente/12345678901'), '/cliente/:id');
    assert.equal(normalizePath('/usuario/123.456.789-01/perfil'), '/usuario/:id/perfil', 'CPF com pontos');
    assert.equal(normalizePath('/tel/11987654321/ver'), '/tel/:id/ver');
    assert.equal(normalizePath('/s/3f2504e0-4f89-11d3-9a0c-0305e82c3301'), '/s/:id');
    assert.equal(normalizePath('/t/9f86d081884c7d659a2feaa0c55ad015'), '/t/:id');
    assert.equal(normalizePath('/k/Ab12Cd34Ef56Gh78Ij90Kl12Mn'), '/k/:id');
    assert.equal(normalizePath('/x/segmento com espaço'), '/x/:id');
    assert.equal(normalizePath('/' + 'abc-'.repeat(40)), '/:id', 'segmento longo demais vira :id');
  });

  test('mantém slugs normais, sem barra final, em minúsculas; ano de 4 dígitos não é identificador', () => {
    assert.equal(normalizePath('/Materia/Programas-de-Fidelidade/'), '/materia/programas-de-fidelidade');
    assert.equal(normalizePath('/agenda/2026'), '/agenda/2026');
    assert.equal(normalizePath('/'), '/');
  });

  test('recusa o que não é caminho utilizável', () => {
    for (const bad of ['', 'materia', '//evil.example/x', 'https://x.invalid/a', '/%E0%A4%A', '/a/b/c/d/e/f/g/h/i']) {
      assert.equal(normalizePath(bad), null, bad);
    }
  });
});

describe('classifyReferrer: só a categoria, nunca o host', () => {
  const own = ['loyaltynews.com.br'];
  const cases: [string | undefined, string][] = [
    [undefined, 'direto'], ['', 'direto'],
    ['https://www.google.com/search?q=milhas', 'busca'], ['https://www.google.com.br/', 'busca'], ['https://duckduckgo.com/', 'busca'], ['https://www.bing.com/x', 'busca'],
    ['https://www.linkedin.com/feed/', 'social'], ['https://lnkd.in/abc', 'social'], ['https://t.co/x', 'social'], ['https://l.instagram.com/?u=x', 'social'],
    ['https://www.loyaltynews.com.br/materia/x', 'interno'], ['https://loyaltynews.com.br/', 'interno'],
    ['https://blog.exemplo.com/post', 'outro'], ['https://mail.exemplo.com/inbox/123', 'outro'],
    ['javascript:alert(1)', 'outro'], ['not a url', 'outro'], ['ftp://x.invalid/', 'outro'],
  ];
  for (const [ref, cat] of cases) test(`${ref ?? '(sem)'} → ${cat}`, () => assert.equal(classifyReferrer(ref, own), cat));

  test('host parecido não vira interno nem busca (sufixo enganoso)', () => {
    assert.equal(classifyReferrer('https://loyaltynews.com.br.evil.example/', own), 'outro');
    assert.equal(classifyReferrer('https://google.com.evil.example/', own), 'outro');
    assert.equal(classifyReferrer('https://notlinkedin.com/', own), 'outro');
  });

  test('o resultado é uma categoria fechada (nunca contém host, caminho ou query)', () => {
    for (const [ref] of cases) assert.match(classifyReferrer(ref, own), /^(direto|busca|social|interno|outro)$/);
  });
});

describe('deviceClass: pela largura, sem user agent', () => {
  test('limiares', () => {
    assert.equal(deviceClass(undefined), 'desconhecido');
    assert.equal(deviceClass(320), 'mobile');
    assert.equal(deviceClass(767), 'mobile');
    assert.equal(deviceClass(768), 'tablet');
    assert.equal(deviceClass(1023), 'tablet');
    assert.equal(deviceClass(1024), 'desktop');
  });
});
