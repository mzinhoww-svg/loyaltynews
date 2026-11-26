import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  PORTAL_EVENTS, PORTAL_EVENT_NAMES, PORTAL_EVENT_SCHEMAS, articleReadFromPublic, fromLegacyCollect, parsePortalEvent, redactSearchQuery,
} from '../portal-events';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('contrato único de eventos do portal', () => {
  test('a lista de eventos e as propriedades batem com os schemas, e nenhum carrega dado pessoal', () => {
    assert.deepEqual(PORTAL_EVENTS.map((e) => e.name), [...PORTAL_EVENT_NAMES]);
    for (const spec of PORTAL_EVENTS) {
      assert.equal(spec.pii, 'nenhum');
      assert.ok(spec.properties.length > 0, `${spec.name} sem propriedades`);
      assert.ok(spec.when.length > 20, `${spec.name} sem a hora de disparo`);
      // cada schema aceita exatamente as propriedades declaradas (fora `name`)
      const shape = PORTAL_EVENT_SCHEMAS[spec.name].shape;
      const declaradas = spec.properties.map((p) => p.replace('?', ''));
      assert.deepEqual(Object.keys(shape).filter((k) => k !== 'name').sort(), declaradas.sort());
    }
  });

  test('page_view normaliza o caminho: sem query, sem fragmento, identificador vira :id', () => {
    const r = parsePortalEvent({ name: 'page_view', path: `/materia/${UUID}/detalhe?utm=1#topo` });
    assert.equal(r.ok, true);
    if (r.ok && r.event.name === 'page_view') assert.equal(r.event.path, '/materia/:id/detalhe');
    assert.deepEqual(parsePortalEvent({ name: 'page_view', path: '/' }), { ok: true, event: { name: 'page_view', path: '/' } });
    assert.equal(parsePortalEvent({ name: 'page_view', path: 'https://fora.invalid/x' }).ok, false);
  });

  test('article_read usa só o payload público (slug + editoria) e leitura entre 3 e 3600 s', () => {
    const ok = { name: 'article_read', slug: 'turbo-livelo', editoria: 'pontos', readSeconds: 45 };
    assert.deepEqual(parsePortalEvent(ok), { ok: true, event: ok });
    for (const over of [
      { readSeconds: 0 }, { readSeconds: 4000 }, { readSeconds: 12.5 },
      { slug: 'Com Espaço' }, { editoria: 'inventada' }, { autor: 'Fulano' },
    ]) {
      assert.equal(parsePortalEvent({ ...ok, ...over }).ok, false, JSON.stringify(over));
    }
  });

  test('a matéria é identificada pelo slug: id interno é recusado como campo desconhecido', () => {
    const ok = { name: 'article_read', slug: 'turbo-livelo', editoria: 'pontos', readSeconds: 45 };
    const r = parsePortalEvent({ ...ok, articleId: UUID });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'evento_invalido');
    // e o schema não tem o campo: nada de id interno no contrato
    assert.ok(!('articleId' in PORTAL_EVENT_SCHEMAS.article_read.shape));
  });

  test('monta o evento com o payload público real da matéria e ignora o resto do payload', () => {
    // Formato da rota pública: slug e editoria estão no payload; o resto (título, resumo, assinatura) existe e é ignorado.
    const publico = {
      slug: 'clube-ficticio-revisa-regras',
      titulo: 'Clube fictício revisa as regras de acúmulo',
      resumo: 'Resumo público da matéria.',
      editoria: 'programas',
      assinatura: 'Redação Loyalty News',
      publicadoEm: '2026-11-21T13:46:46.059Z',
      tipoConteudo: 'noticia',
    };
    assert.deepEqual(articleReadFromPublic(publico, 42), {
      name: 'article_read', slug: 'clube-ficticio-revisa-regras', editoria: 'programas', readSeconds: 42,
    });
    assert.equal(articleReadFromPublic({ ...publico, editoria: 'inventada' }, 42), null);
    assert.equal(articleReadFromPublic({ ...publico, slug: 'Tem Espaço' }, 42), null);
  });

  test('search redige termo com e-mail, CPF, telefone ou UUID e trunca em 120 caracteres', () => {
    assert.equal(redactSearchQuery('  clube   livelo '), 'clube livelo');
    assert.equal(redactSearchQuery('meu email e fulano@exemplo.com'), ':redigido');
    assert.equal(redactSearchQuery('cpf 123.456.789-00'), ':redigido');
    assert.equal(redactSearchQuery('telefone 11987654321'), ':redigido');
    assert.equal(redactSearchQuery(`id ${UUID}`), ':redigido');
    assert.equal(redactSearchQuery('x'.repeat(200)).length, 120);
    // intervalo de anos não é telefone
    assert.equal(redactSearchQuery('black friday 2026 2027'), 'black friday 2026 2027');
    const r = parsePortalEvent({ name: 'search', query: 'meu email e fulano@exemplo.com', resultCount: 3 });
    assert.equal(r.ok, true);
    if (r.ok && r.event.name === 'search') assert.equal(r.event.query, ':redigido');
  });

  test('campo com nome de dado pessoal é recusado antes do schema, com código próprio', () => {
    const r = parsePortalEvent({ name: 'page_view', path: '/', email: 'a@b.c' });
    assert.deepEqual(r, { ok: false, code: 'campo_pessoal', fields: ['email'] });
    assert.deepEqual(parsePortalEvent({ name: 'search', query: 'livelo', resultCount: 1, Cookie: 'x' }), { ok: false, code: 'campo_pessoal', fields: ['Cookie'] });
  });

  test('evento desconhecido, corpo inválido e propriedade extra são recusados', () => {
    assert.equal(parsePortalEvent({ name: 'scroll', path: '/' }).ok, false);
    assert.equal(parsePortalEvent(null).ok, false);
    assert.equal(parsePortalEvent([]).ok, false);
    assert.equal(parsePortalEvent({ name: 'page_view', path: '/', extra: 1 }).ok, false);
    assert.equal(parsePortalEvent({ name: 'search', query: 'ok', resultCount: '3' }).ok, false);
  });

  test('o formato antigo (pageview) é traduzido para o contrato sem perder a classificação', () => {
    assert.deepEqual(fromLegacyCollect({ t: 'pageview', path: '/editoria/mercado?x=1#y', w: 390, ref: 'https://www.google.com/' }), {
      name: 'page_view', path: '/editoria/mercado', referrer: 'busca', device: 'mobile',
    });
    assert.deepEqual(fromLegacyCollect({ t: 'pageview', path: '/', w: 1280, ref: 'https://loyaltynews.com.br/materia' }, ['loyaltynews.com.br']), {
      name: 'page_view', path: '/', referrer: 'interno', device: 'desktop',
    });
    assert.equal(fromLegacyCollect({ t: 'pageview', path: 'relativo' }), null);
    assert.equal(fromLegacyCollect({ t: 'outro', path: '/' }), null);
  });
});
