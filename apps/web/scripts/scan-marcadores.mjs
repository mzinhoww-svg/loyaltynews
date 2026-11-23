// Varredura de marcadores do verify-no-mock. O JS compilado escapa caracteres não ASCII em strings (ex.: "Matéria" vira "Mat\xe9ria"),
// e o JSON e o HTML usam \uHHHH e entidades numéricas. Procurar só a frase literal deixava passar um vazamento (ou um controle positivo
// legítimo) com acento. Por isso cada marcador é procurado no texto cru E no texto com esses escapes desfeitos.
const CP = (n, original) => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : original);

/** Desfaz \xHH, \uHHHH, \u{H...} e entidades numéricas (&#233; e &#xe9;). Escape inválido fica como está. */
export function desfazerEscapes(txt) {
  return txt
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (m, h) => CP(parseInt(h, 16), m))
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => CP(parseInt(h, 16), m))
    .replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => CP(parseInt(h, 16), m))
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (m, h) => CP(parseInt(h, 16), m))
    .replace(/&#(\d{1,7});/g, (m, d) => CP(parseInt(d, 10), m));
}

/** Marcadores (da lista) presentes no texto, na forma literal ou escapada. */
export function marcadoresEm(txt, markers) {
  const achados = [];
  let norm;
  for (const m of markers) {
    if (txt.includes(m)) {
      achados.push(m);
      continue;
    }
    norm ??= desfazerEscapes(txt);
    if (norm.includes(m)) achados.push(m);
  }
  return achados;
}
