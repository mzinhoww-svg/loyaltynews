// Varredura de marcadores do verify-no-mock. O JS compilado escapa caracteres não ASCII em strings (ex.: "Matéria" vira "Mat\xe9ria"),
// e o JSON e o HTML usam \uHHHH e entidades. Procurar só a frase literal deixava passar um vazamento (ou um controle positivo
// legítimo) com acento. Por isso cada marcador é procurado no texto cru E no texto normalizado: escapes desfeitos até o ponto fixo
// (cobre escape duplo, ex.: JSON dentro de string JS), entidades numéricas e as nomeadas mais comuns, e forma NFC (e + U+0301 vira é).
// Limite conhecido: marcador partido por concatenação de strings no código ("Mat" + "éria") não é achado por varredura de texto.
const CP = (n, original) => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : original);

const ENTIDADES = {
  eacute: 'é', Eacute: 'É', egrave: 'è', ecirc: 'ê', aacute: 'á', Aacute: 'Á', agrave: 'à', acirc: 'â', atilde: 'ã', Atilde: 'Ã',
  iacute: 'í', Iacute: 'Í', oacute: 'ó', Oacute: 'Ó', ocirc: 'ô', otilde: 'õ', Otilde: 'Õ', uacute: 'ú', Uacute: 'Ú', ccedil: 'ç', Ccedil: 'Ç',
  mdash: '—', ndash: '–', amp: '&', nbsp: ' ', quot: '"', lt: '<', gt: '>', apos: "'", hellip: '…', laquo: '«', raquo: '»',
};

function umaPassada(txt) {
  return txt
    // Barra dupla (JSON dentro de string JS) vira barra simples; a passada seguinte desfaz o escape. Só vale para a cópia normalizada.
    .replace(/\\\\(?=[ux])/g, '\\')
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (m, h) => CP(parseInt(h, 16), m))
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => CP(parseInt(h, 16), m))
    .replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => CP(parseInt(h, 16), m))
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (m, h) => CP(parseInt(h, 16), m))
    .replace(/&#(\d{1,7});/g, (m, d) => CP(parseInt(d, 10), m))
    .replace(/&([A-Za-z]+);/g, (m, n) => ENTIDADES[n] ?? m);
}

/** Desfaz escapes (\xHH, \uHHHH, \u{H...}) e entidades até nada mais mudar (máx. 5 passadas); escape inválido fica como está. */
export function desfazerEscapes(txt) {
  let atual = txt;
  for (let i = 0; i < 5; i++) {
    const prox = umaPassada(atual);
    if (prox === atual) break;
    atual = prox;
  }
  return atual;
}

/** Marcadores (da lista) presentes no texto, na forma literal, escapada ou decomposta (NFD). */
export function marcadoresEm(txt, markers) {
  const achados = [];
  let norm;
  for (const m of markers) {
    if (txt.includes(m)) {
      achados.push(m);
      continue;
    }
    norm ??= desfazerEscapes(txt).normalize('NFC');
    if (norm.includes(m.normalize('NFC'))) achados.push(m);
  }
  return achados;
}
