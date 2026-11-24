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

// ---- Tokens (GitHub, sk-, Slack, AWS) em arquivo de TESTE ou DOCUMENTAÇÃO: só passa o placeholder EVIDENTE; qualquer outro valor reprova.
// Decisão 23/11/2026 (Security, conferência da ft/backend be051dc): fixtures com marcador de falsidade no valor (a palavra NAO-VAZAR) ou com sequência do alfabeto (ABCDEF…) não são vazamento,
// mas a exclusão genérica de tests/ NÃO vale: um segredo real colado num teste tem de continuar sendo pego. Fora de teste/doc nenhum token passa.
const MARCADORES_FALSOS = /nao[-_]?vazar|fake|falso|falsa|dummy|placeholder|example|exemplo|fixture|redact|nunca[-_]?usar/i;

/** Maior sequência ascendente de caracteres consecutivos (ABCDEFG…, 0123…): chave aleatória real não passa de 3 ou 4. */
function maiorSequenciaAscendente(s) {
  let melhor = 1, atual = 1;
  for (let i = 1; i < s.length; i++) { atual = s.charCodeAt(i) === s.charCodeAt(i - 1) + 1 ? atual + 1 : 1; if (atual > melhor) melhor = atual; }
  return melhor;
}

/** O token é um placeholder evidente? Marcador de falsidade no próprio valor, sequência ascendente de 16+ caracteres ou no máximo 2 caracteres distintos. */
export function tokenEhPlaceholder(token) {
  const corpo = String(token).replace(/^(?:sk|ghp|gho|ghs|ghu|github_pat|xox[baprs]|AKIA)[-_]?/i, '');
  if (MARCADORES_FALSOS.test(corpo)) return true;
  if (maiorSequenciaAscendente(corpo) >= 16) return true;
  if (new Set(corpo.replace(/[-_]/g, '')).size <= 2) return true;
  return false;
}

/** Ocorrências de `re` (com flag g implícita) em `txt` que NÃO são placeholder evidente. Em arquivo de teste/doc os placeholders são ignorados; nos demais, todo achado conta. */
export function tokensReais(txt, re, rel) {
  const testeOuDoc = ARQUIVO_DE_TESTE_OU_DOC.test(rel);
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const reais = [];
  for (const m of txt.matchAll(g)) if (!(testeOuDoc && tokenEhPlaceholder(m[0]))) reais.push(m[0]);
  return reais;
}
