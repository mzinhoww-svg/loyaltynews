// Fixture do teste NEGATIVO de verify-no-mock.mjs: as variáveis que um servidor de PRODUÇÃO nunca pode obedecer
// (sessão simulada do Studio, banco de teste, vitrine e fonte MOCK do portal). Ficam aqui, em caminho de fixture, e são
// passadas ao servidor de produção só para provar que ele as RECUSA. Nenhum build ou execução real usa este módulo.
export const ENV_PROIBIDAS_EM_PRODUCAO = {
  LN_STUDIO_TEST_SESSION: '1',
  LN_STUDIO_DEV_DB: 'pglite',
  PORTAL_VITRINE: '1',
  PORTAL_SOURCE: 'mock',
};
