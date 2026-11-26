import { createElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import Agenda from '../../app/studio/(protegido)/agenda/loading';
import Auditoria from '../../app/studio/(protegido)/auditoria/loading';
import CmsPautas from '../../app/studio/(protegido)/cms/pautas/loading';
import Creative from '../../app/studio/(protegido)/creative/loading';
import Crm from '../../app/studio/(protegido)/crm/loading';
import Decisoes from '../../app/studio/(protegido)/decisoes/loading';
import Midia from '../../app/studio/(protegido)/midia/loading';
import Organogramas from '../../app/studio/(protegido)/organogramas/loading';
import PilotoViolacoes from '../../app/studio/(protegido)/piloto/violacoes/loading';
import Seo from '../../app/studio/(protegido)/seo/loading';
import Watchlists from '../../app/studio/(protegido)/watchlists/loading';

// Contrato das 20 telas (fast-track/qa/contrato-20-telas-62ffd2d3.md): existem loading.tsx em 11
// dessas telas e nenhum era assertado. O estado precisa ser ANUNCIADO e ter marca estável; um
// loading silencioso (null, div vazia, sem aria-busy) falha aqui. Nada de dado inventado: só o esqueleto.
const TELAS: Array<[string, () => ReactElement]> = [
  ['agenda', Agenda],
  ['auditoria', Auditoria],
  ['cms/pautas', CmsPautas],
  ['creative', Creative],
  ['crm', Crm],
  ['decisoes', Decisoes],
  ['midia', Midia],
  ['organogramas', Organogramas],
  ['piloto/violacoes', PilotoViolacoes],
  ['seo', Seo],
  ['watchlists', Watchlists],
];

describe('loading.tsx das 11 telas de leitura do contrato', () => {
  it.each(TELAS)('%s: o carregando é anunciado, com marca estável e sem dado', (_nome, Tela) => {
    const html = renderToStaticMarkup(createElement(Tela));
    // Contrato comum às duas variantes (a própria e a compartilhada CarregandoStudio): o leitor de
    // tela recebe role=status + região viva, e a marca estável permite assertar o estado na tela.
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-estado="carregando"');
    expect(html).toMatch(/Carregando/);
    expect(html).not.toMatch(/<table|<tbody/);
  });
});
