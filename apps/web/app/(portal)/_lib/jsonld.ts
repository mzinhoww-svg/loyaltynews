/**
 * Serializa JSON-LD para dentro de `<script type="application/ld+json">`. `JSON.stringify` NÃO escapa `<`, então um texto como
 * `</script><script>…` vindo do Studio ou da API fecharia o bloco e injetaria script na página (XSS). Aqui `<`, `>` e `&` viram
 * escapes unicode (continuam JSON válido e o valor lido por quem interpreta o JSON-LD é idêntico), e os separadores de linha
 * (U+2028 e U+2029) também. TODA saída JSON-LD do portal passa por esta função.
 */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

export function jsonLdString(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029');
}
