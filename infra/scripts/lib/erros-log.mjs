// Checagem estática contra o vazamento de segredo por log de erro (incidente 23/11/2026: a chave privada do certificado de cliente do ln-staging-db saiu no
// log do worker; decisão da Security r0-preparacao\seguranca\17). Duas regras, só em código de produto (apps/ e packages/, fora de teste):
//   R1  conexão sem `.on('error', …)` no mesmo arquivo (pg Pool/Client, ioredis, BullMQ Worker/Queue/QueueEvents): sem o ouvinte, o Node imprime o erro com
//       util.inspect, incluindo socket/_tlsOptions (ca, cert, key);
//   R2  console.* (ou JSON.stringify/util.inspect) recebendo o ERRO inteiro (identificador de erro puro, objeto com o erro, err.cause/options/socket) em vez de
//       {name, code, message} saneado, e `.on('error', console.error)`.
// Funções puras: recebem o texto e devolvem as ocorrências; nunca imprimem o conteúdo da linha, só o arquivo, a linha e o motivo.

const EXT = /\.(?:[cm]?[jt]sx?)$/i;
const PRODUTO = /^(?:apps|packages)\//;
const FORA = /(^|\/)(?:tests?|e2e|__tests__|__mocks__|fixtures|scripts|node_modules|dist|\.next)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$|(^|\/)(?:playwright|vitest|jest)\.config\.[cm]?[jt]s$/i;

/** O arquivo é código de produto que a checagem cobre? */
export const ehCodigoDeProduto = (rel) => PRODUTO.test(rel) && EXT.test(rel) && !FORA.test(rel);

/** Troca comentários por espaços (mantém as quebras de linha, para a numeração) e deixa strings como estão. */
export function semComentarios(txt) {
  let out = '';
  let i = 0;
  const n = txt.length;
  while (i < n) {
    const c = txt[i], d = txt[i + 1];
    if (c === '/' && d === '/') { while (i < n && txt[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') { while (i < n && !(txt[i] === '*' && txt[i + 1] === '/')) { out += txt[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n && txt[i] !== q) { if (txt[i] === '\\') { out += txt[i] + (txt[i + 1] ?? ''); i += 2; continue; } out += txt[i]; i++; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}
/** Esvazia o CONTEÚDO das strings (as aspas e as quebras de linha ficam): texto dentro de string não é código. */
export function semStrings(t) {
  let out = '';
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < t.length && t[i] !== c) {
        if (t[i] === '\\') { out += ' '; i++; }
        out += t[i] === '\n' ? '\n' : ' '; i++;
      }
      out += c; i++; continue;
    }
    out += c; i++;
  }
  return out;
}
const linhaDe = (txt, idx) => txt.slice(0, idx).split('\n').length;

const CONSTRUTORES = [
  ['pg', ['Pool', 'Client']],
  ['ioredis', ['IORedis', 'Redis']],
  ['bullmq', ['Worker', 'Queue', 'QueueEvents']],
];
const importa = (txt, mod) => new RegExp(`(?:from\\s*|require\\s*\\(\\s*|import\\s*\\(\\s*)['"\`]${mod}['"\`]`).test(txt);
const TEM_OUVINTE = /\.(?:on|once)\(\s*['"`]error['"`]/;

/** R1: conexões criadas num arquivo que não registra `.on('error')`. Devolve [{ linha, construtor, regra }]. */
export function conexoesSemOuvinteDeErro(txt) {
  const t = semComentarios(txt);
  if (TEM_OUVINTE.test(t)) return [];
  const codigo = semStrings(t);
  const achados = [];
  for (const [mod, nomes] of CONSTRUTORES) {
    if (!importa(t, mod)) continue;
    for (const nome of nomes) for (const m of codigo.matchAll(new RegExp(`\\bnew\\s+${nome}\\s*\\(`, 'g'))) achados.push({ linha: linhaDe(t, m.index), construtor: `new ${nome}`, regra: 'R1' });
  }
  return achados.sort((a, b) => a.linha - b.linha);
}

const ERRO_ID = '(?:e|err|error|ex|exc|exception|reason|cause|\\w*Err|\\w*Error)';
const ARG_ERRO_PURO = new RegExp(`^(?:\\.{3})?${ERRO_ID}$`);
const ARG_OBJETO_COM_ERRO = new RegExp(`^\\{\\s*(?:[^{}]*,\\s*)?(?:\\w+\\s*:\\s*)?${ERRO_ID}\\s*(?=[,}])`);
const ARG_INSPECIONA = new RegExp(`(?:\\binspect|JSON\\s*\\.\\s*stringify)\\s*\\(\\s*${ERRO_ID}\\s*[,)]`);
const ARG_CAMPO_PERIGOSO = new RegExp(`\\b${ERRO_ID}\\s*\\.\\s*(?:cause|options|socket|_tlsOptions|errors|response|config|request)\\b`);

/** Argumentos de nível superior de uma chamada: devolve { args, fim } a partir do índice do "(" . */
function argumentosDe(t, abre) {
  const args = [];
  let depth = 0, ini = abre + 1, i = abre;
  for (; i < t.length; i++) {
    const c = t[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; while (i < t.length && t[i] !== q) { if (t[i] === '\\') i++; i++; } continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { args.push(t.slice(ini, i)); return { args: args.map((a) => a.trim()).filter(Boolean), fim: i }; } }
    else if (c === ',' && depth === 1) { args.push(t.slice(ini, i)); ini = i + 1; }
  }
  return { args: args.map((a) => a.trim()).filter(Boolean), fim: i };
}

/** R2: erro cru em log. Devolve [{ linha, motivo, regra }] (sem o texto da linha). */
export function logsDeErroBruto(txt) {
  const sc = semComentarios(txt);
  const t = semStrings(sc);
  const achados = [];
  for (const m of t.matchAll(/\bconsole\s*\.\s*(?:error|warn|log|info|debug|trace)\s*\(/g)) {
    const { args } = argumentosDe(t, m.index + m[0].length - 1);
    for (const a of args) {
      let motivo = null;
      if (ARG_ERRO_PURO.test(a)) motivo = 'o erro inteiro vai para o log (use {name, code, message} saneado)';
      else if (ARG_OBJETO_COM_ERRO.test(a)) motivo = 'objeto de log carrega o erro inteiro';
      else if (ARG_INSPECIONA.test(a)) motivo = 'inspect/JSON.stringify do erro inteiro';
      else if (ARG_CAMPO_PERIGOSO.test(a)) motivo = 'cause/options/socket do erro no log';
      if (motivo) { achados.push({ linha: linhaDe(t, m.index), motivo, regra: 'R2' }); break; }
    }
  }
  for (const m of sc.matchAll(/\.\s*on\s*\(\s*['"`]error['"`]\s*,\s*console\s*\.\s*\w+\s*\)/g)) achados.push({ linha: linhaDe(t, m.index), motivo: ".on('error', console.*) imprime o erro inteiro", regra: 'R2' });
  return achados.sort((a, b) => a.linha - b.linha);
}

/** Todas as ocorrências de um arquivo, já com o caminho. */
export function achadosDoArquivo(rel, txt) {
  if (!ehCodigoDeProduto(rel)) return [];
  return [...conexoesSemOuvinteDeErro(txt).map((a) => ({ ...a, motivo: `${a.construtor}(…) sem .on('error') no arquivo` })), ...logsDeErroBruto(txt)].map((a) => ({ arquivo: rel, linha: a.linha, regra: a.regra, motivo: a.motivo }));
}
