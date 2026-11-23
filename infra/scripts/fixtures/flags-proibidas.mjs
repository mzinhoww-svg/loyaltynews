// Fixture de TESTE (caminho `fixtures/`, reconhecido pelo GLOBAL-TESTFLAGS): as variáveis de ambiente PROIBIDAS fora de teste, com os valores
// proibidos de verdade, para o ensaio do pacote provar que o build e o start as RECUSAM. Não são lidas por nenhum código de deploy.
export const ENV_STUDIO_TEST_SESSION = { LN_STUDIO_TEST_SESSION: '1' };
export const ENV_PORTAL_SOURCE_MOCK = { PORTAL_SOURCE: 'mock' };
