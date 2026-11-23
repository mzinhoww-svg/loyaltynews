// Efeito PÚBLICO das decisões da fila do titular (DP-38) sobre a leitura de Intelligence. A tabela e `efeitosTitular` são do Backend 2 (`../titular-efeito`);
// aqui ficam o consumo e as regras de exibição, iguais em TODA superfície pública que mostra pessoa, cargo ou Move:
//   - remover_pessoa  → a pessoa some de tudo: perfil 404, fora de listas, de empresas, de Moves, de organograma e do grafo;
//   - remover_cargo   → o cargo some (e o Move que o cita como antes/depois também, para não mostrar meia verdade);
//   - remover_* sobre um Move → o Move some;
//   - corrigir        → sobrepõe campos conhecidos (pessoa: `nome`; cargo: `cargo`/`titulo`, `empresa`, `periodo`); chaves desconhecidas são ignoradas;
//   - negado e pedido sem alvo identificado não geram efeito (a fila já os filtra).
// Os ids são os do portal: pessoa = id da pessoa, cargo = id do cargo (`?cargo=` na página da pessoa), move = id do Move. Só o PORTAL (público) é afetado: o Studio vê tudo.
import type { Db } from '@ln/auth';
import type { ApiResult, Db as IntelDb } from '@ln/intelligence';
import { efeitosTitular, type EfeitosTitular } from '../titular-efeito';

export interface EfeitosPublicos {
  /** Para passar a SQL como `text[]` (`id::text <> ALL($n::text[])`): ids que não são UUID simplesmente não casam, sem erro de conversão. */
  pessoas: string[];
  cargos: string[];
  moves: string[];
  pessoaOculta(id: string): boolean;
  cargoOculto(id: string): boolean;
  moveOculto(id: string): boolean;
  /** Primeiro campo presente (texto não vazio) entre `chaves`, da correção do alvo. */
  campo(tipo: 'pessoa' | 'cargo' | 'move', id: string, ...chaves: string[]): string | undefined;
  /** O alvo tem alguma correção aplicada (o portal pode avisar "corrigido a pedido do titular"). */
  corrigido(tipo: 'pessoa' | 'cargo' | 'move', id: string): boolean;
}

export function efeitosPublicos(e: EfeitosTitular): EfeitosPublicos {
  const campos = (tipo: string, id: string) => e.correcoes.get(`${tipo}:${id}`);
  return {
    pessoas: [...e.pessoasOcultas],
    cargos: [...e.cargosOcultos],
    moves: [...e.movesOcultos],
    pessoaOculta: (id) => e.pessoasOcultas.has(id),
    cargoOculto: (id) => e.cargosOcultos.has(id),
    moveOculto: (id) => e.movesOcultos.has(id),
    campo(tipo, id, ...chaves) {
      const c = campos(tipo, id);
      for (const k of chaves) {
        const v = c?.[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return undefined;
    },
    corrigido: (tipo, id) => {
      const c = campos(tipo, id);
      return !!c && Object.keys(c).length > 0;
    },
  };
}

/** Carrega os efeitos vigentes (uma consulta por requisição pública de pessoas/Moves; tabela pequena e indexada pelo estado). */
export async function carregarEfeitos(db: Db): Promise<EfeitosPublicos> {
  return efeitosPublicos(await efeitosTitular(db));
}

// ---------------------------------------------------------------------------------------------------------------------
// Portal legado `/api/intelligence/**` (handlers do pacote do Data, audiência pública): o mesmo efeito, aplicado à RESPOSTA porque o pacote não conhece a fila.
// Só o que o portal vê; o Studio (audiência 'studio') segue vendo tudo.
// ---------------------------------------------------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const nf = (status: number, message: string): ApiResult => ({ status, body: { error: { code: 'not_found', message } } });

/** Pares `pessoa|cargo` dos cargos removidos (as respostas de empresa e organograma não trazem o id do cargo, só pessoa e título). */
async function cargosRemovidos(db: IntelDb, ef: EfeitosPublicos): Promise<Set<string>> {
  if (ef.cargos.length === 0) return new Set();
  const r = await db.query<{ person_id: string; title: string }>(`SELECT person_id, title FROM intelligence.role_assignment WHERE id::text = ANY($1::text[])`, [ef.cargos]);
  return new Set(r.rows.map((x) => `${x.person_id}|${x.title}`));
}

/** Aplica os pedidos do titular decididos à resposta de uma rota PÚBLICA do Portal legado. `rota` = `PUB + path` (ex.: `/api/intelligence/moves`). */
export async function filtrarPortal(db: IntelDb, ef: EfeitosPublicos, rota: string, input: unknown, r: ApiResult): Promise<ApiResult> {
  const i = isObj(input) ? input : {};
  const id = typeof i.id === 'string' ? i.id : '';
  const nome = (pid: string, atual: unknown) => ef.campo('pessoa', pid, 'nome') ?? atual;
  // entradas que apontam para uma pessoa removida: 404 como se não existisse (mesmo antes de ler)
  if (rota.endsWith('/executives/:id') && ef.pessoaOculta(id)) return nf(404, 'executivo não encontrado');
  if (rota.endsWith('/graph/neighbors') && i.type === 'person' && ef.pessoaOculta(id)) return nf(404, 'pessoa não encontrada');
  if (r.status !== 200 || !isObj(r.body)) return r;
  const b = r.body as Obj;
  if (rota.endsWith('/executives/:id') && isObj(b.person) && Array.isArray(b.roles)) {
    const roles = (b.roles as Obj[]).filter((x) => !ef.cargoOculto(String(x.role_id)));
    if (b.roles.length > 0 && roles.length === 0) return nf(404, 'executivo não encontrado'); // sem cargo declarado a página não existe (igual ao contrato novo)
    return {
      status: 200,
      body: {
        ...b,
        person: { ...b.person, full_name: nome(String(b.person.id), b.person.full_name) },
        roles: roles.map((x) => ({ ...x, title: ef.campo('cargo', String(x.role_id), 'cargo', 'titulo') ?? x.title, organization: ef.campo('cargo', String(x.role_id), 'empresa') ?? x.organization })),
      },
    };
  }
  if (rota.endsWith('/executives') && Array.isArray(b.items)) {
    return { status: 200, body: { ...b, items: (b.items as Obj[]).filter((x) => !ef.pessoaOculta(String(x.id))).map((x) => ({ ...x, full_name: nome(String(x.id), x.full_name) })) } };
  }
  if (rota.endsWith('/companies/:id') && Array.isArray(b.people)) {
    const fora = await cargosRemovidos(db, ef);
    const people = (b.people as Obj[]).filter((x) => !ef.pessoaOculta(String(x.person_id)) && !fora.has(`${x.person_id}|${x.title}`));
    return { status: 200, body: { ...b, people: people.map((x) => ({ ...x, full_name: nome(String(x.person_id), x.full_name) })) } };
  }
  if (rota.endsWith('/org-chart') && Array.isArray(b.edges)) {
    const fora = await cargosRemovidos(db, ef);
    const edges = (b.edges as Obj[]).filter(
      (x) => !ef.pessoaOculta(String(x.superior_person_id)) && !ef.pessoaOculta(String(x.subordinate_person_id))
        && !fora.has(`${x.superior_person_id}|${x.superior_title}`) && !fora.has(`${x.subordinate_person_id}|${x.subordinate_title}`),
    );
    return {
      status: 200,
      body: { ...b, edges: edges.map((x) => ({ ...x, superior_name: nome(String(x.superior_person_id), x.superior_name), subordinate_name: nome(String(x.subordinate_person_id), x.subordinate_name) })) },
    };
  }
  if (rota.endsWith('/moves') && Array.isArray(b.items)) {
    const items = (b.items as Obj[]).filter((m) => {
      const before = isObj(m.before) ? String(m.before.role_id) : '';
      const after = isObj(m.after) ? String(m.after.role_id) : '';
      return !ef.pessoaOculta(String(m.person_id)) && !ef.moveOculto(String(m.id)) && !(before && ef.cargoOculto(before)) && !(after && ef.cargoOculto(after));
    });
    return { status: 200, body: { ...b, items: items.map((m) => ({ ...m, person_name: nome(String(m.person_id), m.person_name) })) } };
  }
  if (rota.endsWith('/graph/neighbors') && Array.isArray(b.items)) {
    // um nó, ou um nó no caminho até ele, que seja pessoa removida tira o item (o caminho passaria pela pessoa)
    const ocultos = ef.pessoas.map((p) => `person:${p}`);
    const items = (b.items as Obj[]).filter((x) => {
      const nos = [`${x.node_type}:${x.node_id}`, ...(Array.isArray(x.path) ? x.path.map(String) : [])];
      return !nos.some((n) => ocultos.includes(n));
    });
    return { status: 200, body: { ...b, items } };
  }
  return r;
}
