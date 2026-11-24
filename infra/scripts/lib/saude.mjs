// Saúde ESTÁVEL do /api/health (achado do QA 8 em 24/11, qa8-real-26be6bb.md): uma subida que vai ser recusada (ex.: flag sem decisão para produção) pode responder 200 por
// uma janela curta depois do "Ready" e antes de sair. Um único 200 logo depois do start NUNCA prova que o app está de pé. Regra: N respostas seguidas (padrão 3), espaçadas
// por ~5 s (janela de ~10 s), todas 200 com status "ok", todas com a MESMA versão e, se pedida, a versão esperada.
// Sem dependências; reutilizado por smoke-staging, smoke-producao e healthcheck.
export const CONSECUTIVAS_PADRAO = 3;
export const INTERVALO_PADRAO_MS = 5000;

/** Lê N e o intervalo de `--consecutivas` / `--intervalo` (ms), com a variável LN_SAUDE_INTERVALO_MS (testes) e os padrões. N entre 1 e 20. */
export function configSaude(args = {}, env = process.env) {
  const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : d; };
  const n = num(args['consecutivas'] === true ? undefined : args['consecutivas'], CONSECUTIVAS_PADRAO, 1, 20);
  const intervaloMs = num(args['intervalo'] === true ? undefined : args['intervalo'] ?? env.LN_SAUDE_INTERVALO_MS, INTERVALO_PADRAO_MS, 0, 60000);
  return { n, intervaloMs };
}

/**
 * Pura quanto à rede: `amostrar()` devolve `{ status, j }` (j = corpo JSON ou null) e pode lançar. Devolve
 * `{ ok, n, amostras: [{ status, version, ok }], problemas: [], ultima: {status, j} | null }`. Para na primeira amostra ruim.
 */
export async function saudeEstavel({ amostrar, n = CONSECUTIVAS_PADRAO, intervaloMs = INTERVALO_PADRAO_MS, commit, dormir = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const amostras = [];
  const problemas = [];
  let ultima = null;
  let versao = null;
  for (let i = 0; i < n; i++) {
    if (i > 0 && intervaloMs > 0) await dormir(intervaloMs);
    let r;
    try { r = await amostrar(); } catch (e) { amostras.push({ status: 0, version: null, ok: false }); problemas.push(`amostra ${i + 1} de ${n}: a requisição falhou (${e?.name ?? 'Erro'})`); break; }
    ultima = r;
    const v = r?.j?.version ?? null;
    const ruins = [];
    if (r?.status !== 200) ruins.push(`HTTP ${r?.status}`);
    if (r?.j?.status !== 'ok') ruins.push(`status=${r?.j?.status ?? 'ausente'}`);
    if (commit && v !== commit) ruins.push(`version=${String(v).slice(0, 12)} != ${String(commit).slice(0, 12)}`);
    if (versao !== null && v !== versao) ruins.push(`a versão mudou entre as amostras (${String(versao).slice(0, 12)} → ${String(v).slice(0, 12)})`);
    versao = v;
    amostras.push({ status: r?.status ?? 0, version: v, ok: ruins.length === 0 });
    if (ruins.length) { problemas.push(`amostra ${i + 1} de ${n}: ${ruins.join(', ')}`); break; }
  }
  return { ok: problemas.length === 0 && amostras.length === n, n, amostras, problemas, ultima };
}
