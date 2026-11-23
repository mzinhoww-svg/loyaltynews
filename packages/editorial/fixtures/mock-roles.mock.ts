// MOCK — nomeações fictícias (Empresa Fictícia Alfa, Maria Teste, João Exemplo...). Nada aqui é pessoa, empresa ou fato real.
import { MockFetcher } from './mock-web.mock';
import { mockOk } from './mock-gateway.mock';

export const MOCK_ARTICLE_NOMEACAO = `<html><head><title>MOCK Nomeações</title><link rel="canonical" href="https://ri.mock.example/noticias/nomeacoes"/>
<meta property="article:published_time" content="2026-11-24T10:00:00-03:00"/></head>
<body><article><h1>MOCK: Empresa Fictícia Alfa anuncia mudanças na diretoria</h1>
<p>A Empresa Fictícia Alfa informou nesta terça-feira que Maria Teste será a nova diretora de Marketing da Empresa Fictícia Alfa, a partir de 1º de dezembro de 2026.</p>
<p>João Exemplo deixa o cargo de diretor comercial da Empresa Fictícia Alfa.</p>
<p>Pedro Amostra responde por Parcerias na Empresa Fictícia Alfa.</p></article></body></html>`;

export function mockWebRoles(): MockFetcher {
  return new MockFetcher({
    'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow:',
    'https://ri.mock.example/noticias/nomeacoes': MOCK_ARTICLE_NOMEACAO,
  });
}

/** Rascunho MOCK sobre as nomeações (paráfrase; nada de número fora da evidência). */
export function rolesDraftOutput(evidenceId: string, extraSentence = '') {
  return {
    headline: 'MOCK: Alfa muda a diretoria',
    body:
      'Maria Teste foi nomeada diretora de Marketing da Empresa Fictícia Alfa, com início em 1º de dezembro de 2026. ' +
      'João Exemplo sai do cargo de diretor comercial na Empresa Fictícia Alfa. ' +
      `Pedro Amostra coordena Parcerias na Empresa Fictícia Alfa.${extraSentence}`,
    claims: [
      { id: 'c1', kind: 'fact', text: 'Maria Teste nomeada diretora de Marketing', evidenceIds: [evidenceId] },
      { id: 'c2', kind: 'date', text: '1 de dezembro de 2026', evidenceIds: [evidenceId] },
      { id: 'c3', kind: 'fact', text: 'João Exemplo deixa o cargo de diretor comercial', evidenceIds: [evidenceId] },
    ],
  };
}

export const passAll = (ids: string[]) => ({ verdicts: ids.map((claimId) => ({ claimId, verdict: 'pass' })) });
export { mockOk };
