// Fixtures de conexão: em arquivos de TESTE e de DOCUMENTAÇÃO, URL com senha só passa se o host for obviamente falso (loopback, faixas privadas, nomes
// .example/.invalid/.test/.internal/.local, "exemplo" ou um placeholder de uma letra). Qualquer outro host (ex.: *.vertraweb.app) continua reprovado; fora de
// teste/documentação nada muda. Decisão 23/11/2026 (Fase 3 do staging: os testes de TLS do Backend e do Modelops usam hosts de mentira).
const ARQUIVO_DE_TESTE_OU_DOC = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?|e2e|docs?)\/|\.md$)/i;
const HOST_FALSO = new RegExp(
  '^(?:127\\.0\\.0\\.1|localhost|\\[::1\\]|[a-z]|db|host' +
    '|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}' +
    '|[a-z0-9.-]+\\.(?:example|invalid|test|internal|local|localhost)|exemplo(?:\\.[a-z]+)*|example\\.(?:com|org|net))$',
  'i',
);

/** URLs de conexão com senha que NÃO são fixture óbvia. `rel` é o caminho relativo do arquivo. */
export function conexoesComSenhaReais(txt, rel) {
  const re = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/<>$]+:[^\s@/<>$]+@([^\s/:?#'"`)]*)/gi;
  const testeOuDoc = ARQUIVO_DE_TESTE_OU_DOC.test(rel);
  const reais = [];
  for (const m of txt.matchAll(re)) if (!(testeOuDoc && HOST_FALSO.test(m[1]))) reais.push(m[0]);
  return reais;
}
