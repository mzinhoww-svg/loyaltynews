// GO-LIVE POR COMMIT REVISADO (DP-54, decisão do proprietário 24/11/2026; mesma ideia da ADR-022 para as flags de produto).
// O domínio próprio e a indexação da PRODUÇÃO são DECLARADOS no infra/vertra/environments.json do commit (recurso web do perfil production):
//   "dominio": "www.exemplo.com.br", "indexavel": true
// e o package-web os lê do PRÓPRIO COMMIT. O workflow web-prebuilt (congelado pelo ato raiz) não precisa de parâmetro novo: ele só lê o siteUrl do release.json.
// `--subdomain` continua sendo só o nome do app na Vertra. Valem só para o web do perfil production; em qualquer outro caso a declaração é RECUSADA (staging nunca usa o domínio da marca nem é indexável).

/** Hostname DNS em minúsculas: rótulos de 1 a 63 caracteres (letras, números e hífen no meio), TLD alfabético; sem esquema, porta, barra, curinga nem underscore. */
export const HOST_DOMINIO = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/**
 * Função pura. `web` = recurso do environments.json; `profile` e `appKey` ('web'|'workers') do pacote; `semGoLive` ignora a declaração (teste e plano de volta);
 * `indexavelArg` = o `--indexavel` da linha de comando (go-live manual, como antes). Devolve `{ dominio, indexavel }` ou lança Error com a mensagem de recusa.
 */
export function resolverGoLive({ web, profile, appKey, semGoLive = false, indexavelArg = false }) {
  const dominioDecl = web?.dominio;
  const indexavelDecl = web?.indexavel;
  if (dominioDecl !== undefined) {
    if (typeof dominioDecl !== 'string' || dominioDecl.length > 253 || !HOST_DOMINIO.test(dominioDecl) || dominioDecl.endsWith('.vertraweb.app')) {
      throw new Error(`environments.json: dominio "${String(dominioDecl).slice(0, 80)}" inválido (hostname em minúsculas, sem esquema, sem barra, sem porta, sem curinga e fora de *.vertraweb.app: para esse use o subdomínio)`);
    }
    if (profile !== 'production' || appKey !== 'web') throw new Error('environments.json: "dominio" só vale para o web do perfil production (staging nunca usa o domínio da marca)');
  }
  if (indexavelDecl !== undefined) {
    if (typeof indexavelDecl !== 'boolean') throw new Error('environments.json: "indexavel" tem de ser true ou false');
    if (indexavelDecl && (profile !== 'production' || appKey !== 'web')) throw new Error('environments.json: "indexavel": true só vale para o web do perfil production (staging nunca é indexável)');
  }
  const aplica = !semGoLive && appKey === 'web';
  return {
    dominio: aplica && typeof dominioDecl === 'string' ? dominioDecl : null,
    indexavel: Boolean(indexavelArg) || (aplica && indexavelDecl === true),
  };
}
