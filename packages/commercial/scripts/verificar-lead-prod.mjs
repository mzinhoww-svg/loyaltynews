// Verificação pós-deploy do ciclo do lead (exclusão e retenção). SOMENTE LEITURA: lê arquivos já exportados, o /api/health público
// e o histórico do git. Não chama a Vertra, não lê variável de ambiente de produção e não recebe segredo.
//
// uso: node packages/commercial/scripts/verificar-lead-prod.mjs \
//   --web-health <url ou arquivo JSON do /api/health>
//   --worker-commit <sha do pacote que está no worker, informado pelo DevOps>
//   --worker-releases <arquivo JSON do list_releases do worker>
//   --worker-log <arquivo texto do get_logs do worker>
//   --salt-web sim|nao --salt-workers sim|nao --salt-igual sim|nao   (leitura do DevOps; nunca o valor)
//   [--repo <pasta do git>] [--retencao <sha>] [--exclusao <sha>]
// saída: 0 = aprovado; 1 = reprovado; 2 = uso incorreto. Informação ausente REPROVA (falha fechada).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RETENCAO = 'e894a4a5'; // worker passa a apagar o lead (DP-55)
const EXCLUSAO = '23e6713b'; // rota DELETE do lead e trilha

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) { console.error('uso incorreto perto de: ' + (argv[i] ?? '(fim)')); process.exit(2); }
  args[argv[i].slice(2)] = argv[i + 1];
}
const repo = args.repo ?? process.cwd();
const retencao = args.retencao ?? RETENCAO;
const exclusao = args.exclusao ?? EXCLUSAO;
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const contem = (commit, base) => { try { git('merge-base', '--is-ancestor', base, commit); return true; } catch { return false; } };
try { git('cat-file', '-e', `${retencao}^{commit}`); git('cat-file', '-e', `${exclusao}^{commit}`); } catch { console.error('o repositório não tem os commits de referência (rode git fetch)'); process.exit(2); }
const texto = (p) => { const t = readFileSync(p, 'utf8'); return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t; };

const itens = [];
const item = (nome, ok, detalhe) => itens.push({ nome, ok: ok === true, detalhe });

// 1. web
let web;
try {
  const origem = args['web-health'];
  web = JSON.parse(/^https?:/.test(origem) ? await (await fetch(origem, { signal: AbortSignal.timeout(20000) })).text() : texto(origem));
} catch { web = null; }
item('web: health de produção', web?.status === 'ok' && web?.env === 'production', web ? `env=${web.env} versão=${String(web.version).slice(0, 12)}` : 'não informado ou ilegível');
item('web: contém a rota de exclusão', !!web?.version && contem(web.version, exclusao), `exige ${exclusao}`);

// 2. worker: commit declarado
const wc = args['worker-commit'];
item('worker: commit contém a retenção', !!wc && contem(wc, retencao), wc ? `commit=${wc.slice(0, 12)}, exige ${retencao}` : 'commit não informado');

// 3. worker: houve envio de CÓDIGO depois de a retenção existir (mudar APP_COMMIT sozinho não troca o código)
let releases;
try {
  const j = JSON.parse(texto(args['worker-releases']));
  releases = (j.untrusted_content ?? j).data ?? j;
  if (!Array.isArray(releases)) releases = null;
} catch { releases = null; }
const dataRetencao = Date.parse(git('log', '-1', '--format=%cI', retencao));
const codigo = (releases ?? []).filter((r) => r.source !== 'env_change' && Number(r.files_changed) > 0).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
item('worker: envio de código posterior à retenção', !!codigo && Date.parse(codigo.created_at) > dataRetencao,
  codigo ? `último envio de código ${codigo.created_at}; retenção de ${new Date(dataRetencao).toISOString()}` : releases ? 'nenhum envio de código na lista' : 'releases não informados');

// 4. worker: log da ÚLTIMA subida
let log;
try { log = texto(args['worker-log']); try { log = JSON.parse(log).untrusted_content ?? log; } catch { /* texto puro */ } } catch { log = ''; }
const linhas = log.split(/\r?\n/);
const inicio = linhas.map((l) => l.includes('guard-env OK')).lastIndexOf(true);
const subida = inicio >= 0 ? linhas.slice(inicio) : [];
const quando = Date.parse(subida[0]?.split(' ')[0] ?? '');
item('worker: log da subida traz "[workers] filas:"', subida.some((l) => l.includes('[workers] filas:')), subida.length ? `subida de ${subida[0].split(' ')[0]}` : 'log sem uma subida completa');
item('worker: subiu e ficou no ar, sem falha de retenção', subida.some((l) => l.includes('[workers] no ar')) && !subida.some((l) => /subida recusada|retenção de leads falhou/.test(l)), 'procura "[workers] no ar"; recusa "subida recusada" e "retenção de leads falhou"');
item('worker: a subida é posterior ao envio de código', !!codigo && Number.isFinite(quando) && quando >= Date.parse(codigo.created_at), 'a subida do log tem de rodar o código enviado');

// 5. sal (só sim/não)
for (const [chave, nome] of [['salt-web', 'sal presente no web'], ['salt-workers', 'sal presente no worker'], ['salt-igual', 'sal igual nos dois']]) {
  item(nome, args[chave] === 'sim', args[chave] === 'sim' || args[chave] === 'nao' ? `informado: ${args[chave]}` : 'não informado');
}

for (const i of itens) console.log(`${i.ok ? 'OK    ' : 'FALHA '} ${i.nome} — ${i.detalhe}`);
if (wc && web?.version && !web.version.startsWith(wc) && !wc.startsWith(web.version)) console.log(`AVISO  web e worker em commits diferentes (${web.version.slice(0, 12)} x ${wc.slice(0, 12)}); confira se é intencional`);
const falhas = itens.filter((i) => !i.ok).length;
console.log(falhas ? `REPROVADO: ${falhas} de ${itens.length} itens falharam` : `APROVADO: ${itens.length} de ${itens.length} itens`);
console.log('Não prova: exclusão de um lead real em produção, nem uma rodada de retenção que tenha apagado algo.');
process.exitCode = falhas ? 1 : 0;
