// Importa .sql como TEXTO (esbuild --loader:.sql=text; usado só por bench-graph.main.ts, que não roda no vitest).
declare module '*.sql' {
  const text: string;
  export default text;
}
