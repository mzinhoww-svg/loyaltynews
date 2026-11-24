// Ambiente com que o `ci-checks --deploy` é rodado POR DENTRO dos empacotadores (package-web e package-prebuilt).
// O que a regra de ambiente protege é o ambiente de EXECUÇÃO do app (as variáveis do app na Vertra, declaradas em infra/vertra/environments.json e no release.json), não o processo
// que empacota. O processo do empacotador herda coisas que não são do app: no GitHub Actions o runner define CI=true (a regra "CI=true em ambiente de deploy" reprovava o pacote, 24/11).
// Por isso o ci-checks roda com um ambiente SANEADO: só variáveis do sistema (para o Node rodar) + o ambiente DECLARADO do pacote (APP_ENV e o `env` do recurso no environments.json).
// Se o pacote DECLARA algo proibido (por exemplo `CI: "true"` no environments.json), a regra continua reprovando; o ambiente do runner é que deixa de contar.

/** Variáveis do sistema operacional necessárias para o Node e o git rodarem; nenhuma delas é variável do app. */
export const VARIAVEIS_DO_SISTEMA = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL'];

/**
 * Pura. Devolve o ambiente do processo filho que roda o ci-checks: `base` filtrado às variáveis do sistema, mais `declarado` (objeto nome -> valor em texto) e `APP_ENV`.
 * Valores que não são texto ou número são ignorados.
 */
export function ambienteDoPacote({ declarado = {}, appEnv, base = process.env } = {}) {
  const out = {};
  for (const k of VARIAVEIS_DO_SISTEMA) if (base[k] !== undefined) out[k] = base[k];
  for (const [k, v] of Object.entries(declarado ?? {})) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  if (appEnv) out.APP_ENV = String(appEnv);
  return out;
}
