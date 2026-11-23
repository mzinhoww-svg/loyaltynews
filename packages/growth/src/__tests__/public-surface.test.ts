import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import * as indexEntry from '../index';
import * as uiEntry from '../ui';
import * as dashboardEntry from '../dashboard';
import * as jobsEntry from '../jobs';
import * as testingEntry from '../testing';
import * as rasterEntry from '../creative/raster';
import { LIVE_ACK } from '../mlabs/live';
import { createSocialPublisher, PUBLISHER_SOCIAL } from '../publisher/publisher';

// Superfície pública de @ln/growth (QA 2): não existe caminho para criar, agendar, editar ou excluir post sem passar pelo
// publicador. O adaptador (simulado e real) só nasce dentro de `createSocialPublisher`, junto com a capability de escrita;
// classe, `mintWriteCapability` e `bindWriteAuthority` não são exportados por nenhuma entrada do pacote.

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '../..');
const SRC = resolve(PKG, 'src');

const ENTRIES: Record<string, Record<string, unknown>> = {
  '.': indexEntry,
  './ui': uiEntry,
  './dashboard': dashboardEntry,
  './jobs': jobsEntry,
  './testing': testingEntry,
  './raster': rasterEntry,
};

/** Nomes que nunca podem estar acessíveis por uma entrada pública, nem como export nem como membro de objeto alcançável. */
const FORBIDDEN_EXPORTS = [
  'mintWriteCapability', 'bindWriteAuthority', 'WriteGate', 'SimulatedMlabsAdapter', 'LiveMlabsAdapter',
  'buildLiveAdapter', 'createLiveMlabsAdapter', 'SocialPublisher', 'SimulatedGateway',
];
const FORBIDDEN_MEMBERS = ['createPost', 'updatePost', 'deletePost', 'bindWriteAuthority', 'mintWriteCapability', 'transport', 'adapter', 'payloadMapper'];

/** Todos os objetos e funções alcançáveis por propriedades de valor (sem invocar getters), com protótipos. */
function reach(roots: unknown[], maxDepth = 10): { members: Set<string>; objects: unknown[] } {
  const seen = new Set<unknown>();
  const members = new Set<string>();
  const objects: unknown[] = [];
  const skip = new Set<unknown>([Object.prototype, Function.prototype, Array.prototype, Error.prototype, Promise.prototype, Map.prototype, Set.prototype]);
  const visit = (v: unknown, depth: number): void => {
    if ((typeof v !== 'object' && typeof v !== 'function') || v === null || seen.has(v) || skip.has(v) || depth > maxDepth) return;
    seen.add(v);
    objects.push(v);
    for (const key of Reflect.ownKeys(v)) {
      if (typeof key === 'symbol') continue;
      members.add(key);
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (d && 'value' in d) visit(d.value, depth + 1);
    }
    visit(Object.getPrototypeOf(v), depth + 1);
  };
  for (const r of roots) visit(r, 0);
  return { members, objects };
}

function publishers() {
  const sim = createSocialPublisher({ mode: 'simulated' });
  const live = createSocialPublisher({
    mode: 'live',
    transport: { call: async () => ({}) },
    liveAck: LIVE_ACK,
    actor: PUBLISHER_SOCIAL,
    flags: () => ({ growth_linkedin_live: true, growth_instagram_enabled: false, growth_the_loyal_enabled: false }),
  });
  return { sim, live };
}

describe('superfície pública: nenhum caminho para escrever sem o publicador', () => {
  test('nenhuma entrada exporta adaptador, capability, bind ou a classe do publicador', () => {
    for (const [entry, mod] of Object.entries(ENTRIES)) {
      for (const name of FORBIDDEN_EXPORTS) {
        assert.equal(name in mod, false, `${entry} exporta ${name}`);
      }
    }
    assert.equal(typeof indexEntry.createSocialPublisher, 'function', 'a única porta é a fábrica do publicador');
  });

  test('nada exportado, e nada alcançável a partir dos exports, tem createPost/update/delete/bind/mint/transport/adapter', () => {
    const roots = Object.values(ENTRIES).flatMap((m) => Object.values(m));
    const { members, objects } = reach(roots);
    for (const m of FORBIDDEN_MEMBERS) assert.equal(members.has(m), false, `membro alcançável: ${m}`);
    for (const o of objects) {
      for (const m of FORBIDDEN_MEMBERS) {
        assert.equal(Object.prototype.hasOwnProperty.call(o, m), false, `objeto alcançável com ${m}`);
      }
    }
    assert.ok(objects.length > 50, 'a varredura percorreu a superfície de verdade');
  });

  test('o objeto do publicador (simulado e real) e suas visões não expõem adaptador, escrita, capability nem transporte', () => {
    const { sim, live } = publishers();
    for (const p of [sim, live]) {
      const { members, objects } = reach([p, p.reads, p.simulated]);
      for (const m of FORBIDDEN_MEMBERS) assert.equal(members.has(m), false, `${p.mode}: ${m}`);
      for (const o of objects) {
        for (const m of FORBIDDEN_MEMBERS) assert.equal(Object.prototype.hasOwnProperty.call(o, m), false);
      }
      assert.ok(Object.isFrozen(p), 'o publicador é congelado');
      assert.equal(Object.getPrototypeOf(p), Object.prototype, 'sem classe/construtor alcançável (p.constructor é Object)');
      assert.equal(p.constructor, Object);
      assert.deepEqual(Object.keys(p.reads).sort(), ['getPostLimits', 'listChannels', 'listTemplates', 'mode']);
    }
    assert.deepEqual(Object.keys(sim.simulated ?? {}).sort(), ['count', 'inspect']);
    assert.equal(live.simulated, undefined);
  });

  test('a visão simulada é só leitura: nenhuma função alcançável a partir do publicador cria post sem passar por publish', async () => {
    const { sim } = publishers();
    const { objects } = reach([sim, sim.reads, sim.simulated]);
    const skipNames = new Set(['publish', 'edit', 'remove', 'uploadMedia']);
    for (const o of objects) {
      if (typeof o !== 'function') continue;
      if (skipNames.has(o.name)) continue;
      for (const args of [[], [undefined], [{}], ['x'], [{ channel: 'linkedin', text: 't', imageRef: 'i', mentions: [] }, 'k']]) {
        try {
          await (o as (...a: unknown[]) => unknown)(...args);
        } catch {
          /* recusa esperada */
        }
      }
    }
    assert.equal(sim.simulated!.count, 0);
    assert.deepEqual(sim.audit, []);
  });

  test('dois publicadores têm adaptadores independentes (nada compartilhado, nada a vincular antes)', async () => {
    const a = createSocialPublisher({ mode: 'simulated', now: () => 't' });
    const b = createSocialPublisher({ mode: 'simulated', now: () => 't' });
    assert.notEqual(a, b);
    assert.equal(a.simulated!.count, 0);
    assert.equal(b.simulated!.count, 0);
  });

  test('grafo de módulos: nenhuma entrada reexporta módulo interno ou mock (em qualquer profundidade)', () => {
    const entries = ['index.ts', 'ui/index.ts', 'dashboard/index.ts', 'jobs/index.ts'].map((f) => resolve(SRC, f));
    const visited = new Set<string>();
    const reexported: string[] = [];
    const walk = (file: string): void => {
      if (visited.has(file)) return;
      visited.add(file);
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/export\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+'(\.[^']+)'/g)) {
        const target = resolve(dirname(file), m[1] ?? '');
        reexported.push(target);
        for (const ext of ['.ts', '/index.ts']) {
          try {
            readFileSync(target + ext);
            walk(target + ext);
            break;
          } catch {
            /* tenta a próxima extensão */
          }
        }
      }
    };
    entries.forEach(walk);
    assert.ok(reexported.length > 10);
    for (const t of reexported) {
      assert.doesNotMatch(t, /\.internal$/, t);
      assert.doesNotMatch(t, /\.mock$/, t);
    }
  });

  test('package.json: só seis subpaths (`testing` exporta só a suíte de conformidade do registro de envios; `raster` só o rasterizador SVG→PNG, server-side, sem rede), todos em src/, nenhum wildcard nem módulo interno', () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG, 'package.json'), 'utf8')) as { exports: Record<string, string> };
    assert.deepEqual(Object.keys(pkg.exports).sort(), ['.', './dashboard', './jobs', './raster', './testing', './ui']);
    for (const v of Object.values(pkg.exports)) {
      assert.match(v, /^\.\/src\/(index|ui\/index|dashboard\/index|jobs\/index|testing|creative\/raster)\.ts$/);
    }
  });

  test('o código-fonte não tem outro construtor do adaptador fora do publicador e do módulo interno', () => {
    const offenders: string[] = [];
    const files = ['publisher/publisher.ts', 'dashboard/handlers.ts', 'jobs/social-package.job.ts', 'package/linkedin.ts', 'package/instagram.ts', 'copy/engine.ts', 'creative/post.ts'];
    for (const f of files) {
      const t = readFileSync(resolve(SRC, f), 'utf8');
      const importsAdapters = /simulated\.mock|live-adapter\.internal|write-gate\.internal/.test(t);
      if (importsAdapters && f !== 'publisher/publisher.ts') offenders.push(f);
    }
    assert.deepEqual(offenders, [], 'só publisher.ts pode importar adaptadores e a capability');
  });
});
