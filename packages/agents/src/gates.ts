/**
 * Gates G1–G6 do plano de ativação: critérios MEDÍVEIS (o que medir, como, limiar, dono) e a
 * avaliação do que se pode conferir OFFLINE a partir do repositório. O que depende de staging,
 * ratificação, medição real ou terceiros fica `external`: este módulo nunca declara um gate atendido
 * sem evidência. Os limiares marcados "proposta AgentOps" são sugestões a ratificar, não regras da política.
 * Usa fs: não é exportado por `index.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenBotDraft, validateOpenBotDraft } from './openbot-profiles';
import { loadRegistries } from './config';
import { PKG_DIR } from './paths';

export type CriterionStatus = 'met_offline' | 'unmet' | 'external';

export interface Criterion {
  id: string;
  text: string;
  /** como medir, com comando ou fonte */
  measure: string;
  /** limiar de aprovação */
  threshold: string;
  owner: string;
  /** `true`: o limiar é sugestão desta frente, a ratificar */
  proposedThreshold?: boolean;
  /** dependente do tempo (preço vence em 7 dias): não entra no artefato determinístico */
  timeDependent?: boolean;
}

export interface Gate {
  id: 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';
  name: string;
  decidedBy: string;
  criteria: Criterion[];
}

/** SHA-256 da proposta P5 v2 (arquitetura/meetings.registry.proposto-P5-v2.json). */
export const P5_V2_SHA256 = 'a18e0a7150db095bf411a0f3ddd1123e15cf25ddd94f9656ddef3eaae2824264';

/** Teste de fronteira da `recovery_policy.boundary_tests` → trecho do nome do teste que o cobre. */
export const BOUNDARY_TEST_COVERAGE: Record<string, string> = {
  'restart at +120 min -> runs': '+0 e +120 min: roda',
  'restart at +121 min -> status_only': '+121 min: status_only',
  'host off overnight -> previous day meetings become status_only': 'host desligado a noite toda',
  'Monday holiday -> weekly on Tuesday': 'segunda feriado: semanal roda na terça',
  'two restarts inside the window -> one execution': 'PC desligado às 06:00 e religado às 07:30',
  'D-sync with a dependency still pending at 08:00 -> waits; dependency becomes status_only at its deadline -> D-sync runs before 09:25': 'dependência que falhou: D-sync fica em waiting',
  'host back at 09:30 -> D-sync status_only': 'passada a janela vira status_only',
  'Monday holiday: W-pautas moves to Tuesday 08:00 with key W-pautas+<Monday date>; a second restart on Tuesday does not duplicate': 'chave da data ORIGINAL',
};

export const GATES: Gate[] = [
  {
    id: 'G1',
    name: 'Ratificar P5 v2 (item 11 das mudanças protegidas)',
    decidedBy: 'Proprietário + verificador independente (cerimônia protegida, lote separado, depois do aceite de R4-11)',
    criteria: [
      { id: 'G1.1', text: 'Os rituais carregados são exatamente a P5 v2', measure: 'sha256 de data/meetings.registry.json igual ao de arquitetura/meetings.registry.proposto-P5-v2.json', threshold: `== ${P5_V2_SHA256.slice(0, 12)}…`, owner: 'AgentOps' },
      { id: 'G1.2', text: 'Cada teste de fronteira da recovery_policy tem teste automatizado', measure: 'mapa boundary_tests → nome de teste em scheduler.test.ts (+ `npm test` verde)', threshold: '8 de 8 cobertos e passando', owner: 'AgentOps' },
      { id: 'G1.3', text: 'Calendário 2026–2027: nenhum ritual em feriado nacional; 1º dia útil do mês correto (R4-11)', measure: 'calendar.test.ts, bloco "ocorrências de rituais"', threshold: '100% dos feriados nacionais 2026–2027 sem ritual', owner: 'AgentOps' },
      { id: 'G1.4', text: 'Ratificação assinada e aplicada em contracts/meetings.registry.json', measure: 'registro da cerimônia + hash do contrato protegido', threshold: 'assinatura presente e hash do contrato == P5 v2', owner: 'Proprietário/verificador' },
    ],
  },
  {
    id: 'G2',
    name: 'Qualificar modelos dos rituais (R2-07/08)',
    decidedBy: 'Verificador independente / FinOps',
    criteria: [
      { id: 'G2.1', text: 'Cada modelo das rotas economy/review/premium/strategic tem ID e preço verificados', measure: 'política: binding.openrouter_id e price_as_of; rate card conferido no /api/v1/models', threshold: 'price_as_of ≤ price_expiry_days (7) na data do uso', owner: 'FinOps', timeDependent: true },
      { id: 'G2.2', text: 'Saída fora do esquema é rejeitada e a válida passa (R4-04)', measure: 'validateAgentOutput sobre o golden set, por perfil e por modelo', threshold: '≥ 99% de saídas válidas por rota; 0 saídas inválidas aceitas', owner: 'AgentOps + QA', proposedThreshold: true },
      { id: 'G2.3', text: 'Qualidade PT-BR frente ao golden set', measure: 'avaliação cega comparando o modelo candidato com a referência (claude-sonnet-5-5)', threshold: 'não pior que a referência em fidelidade factual; limiar numérico a definir com a Editorial', owner: 'Editorial + QA' },
      { id: 'G2.4', text: 'ZDR / data_collection=deny disponível por modelo', measure: 'consulta ao endpoint do provedor no OpenRouter', threshold: 'confirmado para 100% dos modelos usados', owner: 'Security' },
      { id: 'G2.5', text: 'Resposta traz usage e evidência de geração (custo conciliável)', measure: 'sampleFromResponse(resposta) != null em 100% das chamadas de teste em staging', threshold: '100%', owner: 'AgentOps + Backend' },
    ],
  },
  {
    id: 'G3',
    name: 'Banco de staging com as migrações da organização',
    decidedBy: 'DevOps',
    criteria: [
      { id: 'G3.1', text: 'Migrações 0004_agentic_org e 0005_agents_reschedule existem e estão no journal', measure: 'packages/db/drizzle/meta/_journal.json', threshold: 'ambas presentes', owner: 'Arquiteto' },
      { id: 'G3.2', text: 'As migrações aplicam e o PgStore passa os testes de idempotência, atomicidade e CHECKs', measure: 'pg.test.ts (PGlite)', threshold: '100% dos testes', owner: 'AgentOps' },
      { id: 'G3.3', text: 'Aplicadas no PostgreSQL de staging', measure: 'select das 6 tabelas no staging', threshold: '6 tabelas e as restrições presentes', owner: 'DevOps' },
    ],
  },
  {
    id: 'G4',
    name: 'Ledger de orçamento e saldo persistidos em PostgreSQL',
    decidedBy: 'Backend + FinOps (pacote modelops)',
    criteria: [
      { id: 'G4.0', text: 'O armazenamento PostgreSQL implementa AtomicLedgerStore e passa a suíte de aceitação do contrato (A01–A12, incluindo A10 com SQL cru)', measure: 'defineLedgerAcceptance sobre o PgLedgerStore (ledger-contract.md)', threshold: '12 de 12 casos passando, nenhum "skipped"', owner: 'Backend' },
      { id: 'G4.1', text: 'Transação por mês com exclusão mútua entre processos', measure: 'caso A07: 200 reservas concorrentes por dois handles contra teto de US$ 10', threshold: 'exatamente 100 aceitas e 0 estouros; mais um teste de estresse de 1000 (proposta)', owner: 'Backend', proposedThreshold: true },
      { id: 'G4.2', text: 'Replay do ledger reproduz o gasto', measure: 'replay == soma das gerações conciliadas', threshold: 'diferença ≤ 1% (limite proposto no modelops)', owner: 'FinOps' },
      { id: 'G4.3', text: 'Saldo do provedor lido antes da primeira chamada', measure: 'BalanceGuard injetado na composição do produto', threshold: 'leitura obrigatória; falha de leitura bloqueia', owner: 'Backend' },
    ],
  },
  {
    id: 'G5',
    name: 'Adaptador OpenBot e mapeamento perfil → agente',
    decidedBy: 'Integration + Program Manager (aval para criar agentes)',
    criteria: [
      { id: 'G5.1', text: 'O rascunho de perfis cobre os 64 perfis exatamente uma vez, preside os 28 rituais e é dono dos 19 workflows', measure: 'validateOpenBotDraft', threshold: '0 problemas', owner: 'AgentOps' },
      { id: 'G5.2', text: 'Aval do Program Manager ao rascunho (nome, título, divisão da Editorial)', measure: 'mensagem registrada', threshold: 'aval explícito', owner: 'Program Manager' },
      { id: 'G5.3', text: 'Adaptador por pull com lease, só conexão de saída, callback assinado e idempotente (R2-10, testes 2, 3, 6 e 7)', measure: 'suíte do adaptador', threshold: '100%', owner: 'Integration' },
      { id: 'G5.4', text: 'Teste negativo por agente: nenhum agente lê credencial ou memória de produção que não é sua (R2-09, teste 11)', measure: 'teste por agente criado', threshold: '8 de 8 agentes negam', owner: 'Security' },
      { id: 'G5.5', text: 'Nenhuma credencial de provedor na configuração dos agentes', measure: 'varredura da configuração (ADR-003)', threshold: '0 ocorrências', owner: 'Security' },
      { id: 'G5.6', text: 'Editorial em 1 agente até a medição; critérios S1–S3 de divisão avaliados com 30+ execuções medidas', measure: 'editorial_split_criteria do rascunho + harness de tokens/latência', threshold: 'S1, S2 e S3 dentro do limiar; senão dividir', owner: 'AgentOps + PM', proposedThreshold: true },
    ],
  },
  {
    id: 'G6',
    name: 'Insumos dos rituais: digest determinístico e coletor',
    decidedBy: 'Backend + Editorial',
    criteria: [
      { id: 'G6.1', text: 'Formato do insumo estruturado definido e validado (ParticipantInput) e coletor do banco', measure: 'schemas.ts + StoreInputCollector + testes', threshold: 'presentes e passando', owner: 'AgentOps' },
      { id: 'G6.2', text: 'Worker de digest roda às 05:30 e o insumo existe antes de cada ritual (ADR-014)', measure: 'log do worker x meeting_runs.scheduled_for na fase F1/F2', threshold: '100% dos rituais com digest anterior ao horário', owner: 'Backend' },
      { id: 'G6.3', text: 'Rituais sem insumo viram status_only (regra do silêncio) sem chamada de modelo', measure: 'meeting_runs: status_only → model_calls = 0', threshold: '100%', owner: 'AgentOps' },
    ],
  },
];

export interface GateEvaluation {
  criterion: string;
  status: CriterionStatus;
  evidence: string;
}

const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');

/** Avalia o que é verificável offline. Tudo o mais é `external`; nenhum gate é declarado atendido por este módulo. */
export function evaluateGatesOffline(repoRoot = join(PKG_DIR, '../..')): GateEvaluation[] {
  const out: GateEvaluation[] = [];
  const set = (criterion: string, ok: boolean, evidence: string) => out.push({ criterion, status: ok ? 'met_offline' : 'unmet', evidence });
  const external = (criterion: string, evidence: string) => out.push({ criterion, status: 'external', evidence });

  const sources = JSON.parse(read(join(PKG_DIR, 'data/SOURCES.json')) || '{}') as { arquivos?: Record<string, { sha256: string }> };
  const sha = sources.arquivos?.['meetings.registry.json']?.sha256;
  set('G1.1', sha === P5_V2_SHA256, `SOURCES.json: ${sha ?? 'ausente'}`);

  const reg = loadRegistries();
  const schedTest = read(join(PKG_DIR, 'src/scheduler.test.ts'));
  const policyTests = reg.recoveryPolicy.boundary_tests;
  const missing = policyTests.filter((b) => !BOUNDARY_TEST_COVERAGE[b] || !schedTest.includes(BOUNDARY_TEST_COVERAGE[b]!));
  set('G1.2', missing.length === 0 && policyTests.length === 8, missing.length ? `sem teste: ${missing.join(' | ')}` : `${policyTests.length} de ${policyTests.length} testes de fronteira mapeados em scheduler.test.ts (a execução verde é de \`npm test\`)`);
  const calTest = read(join(PKG_DIR, 'src/calendar.test.ts'));
  set('G1.3', calTest.includes('nenhum ritual agendado em feriado nacional'), 'calendar.test.ts');
  external('G1.4', 'depende da cerimônia protegida; o contrato contracts/meetings.registry.json não é editado por esta frente');

  external('G2.1', 'preço vence em 7 dias: conferir na data do uso (dependente do tempo)');
  const outTest = read(join(PKG_DIR, 'src/output.test.ts'));
  out.push({ criterion: 'G2.2', status: 'external', evidence: outTest ? 'o validador por perfil existe (output.test.ts, 64 perfis); falta o golden set real e a taxa por modelo' : 'validador ausente' });
  for (const id of ['G2.3', 'G2.4']) external(id, 'exige medição/consulta real fora deste pacote');
  const measureSrc = read(join(PKG_DIR, 'src/measure.ts'));
  out.push({ criterion: 'G2.5', status: 'external', evidence: measureSrc.includes('sampleFromResponse') ? 'sampleFromResponse existe; falta rodar em staging com chamadas reais' : 'harness ausente' });

  const journal = read(join(repoRoot, 'packages/db/drizzle/meta/_journal.json'));
  set('G3.1', journal.includes('0004_agentic_org') && journal.includes('0005_agents_reschedule'), 'packages/db/drizzle/meta/_journal.json');
  const pgTest = read(join(PKG_DIR, 'src/pg.test.ts'));
  set('G3.2', pgTest.includes('PgStore sobre as migrações oficiais'), 'pg.test.ts presente (execução verde é de `npm test`)');
  external('G3.3', 'não existe banco de staging');

  external('G4.0', 'a suíte existe (ledger-contract) e passa na implementação de referência; falta o PgLedgerStore do Backend');
  for (const id of ['G4.1', 'G4.2', 'G4.3']) external(id, 'pacote modelops (Backend + FinOps): fora desta frente');

  const draft = buildOpenBotDraft(reg);
  const issues = validateOpenBotDraft(draft, reg);
  set('G5.1', issues.length === 0, issues.length ? issues.map((i) => i.code).join(', ') : '8 agentes cobrem 64 perfis, 28 rituais e 19 workflows; created=false');
  for (const id of ['G5.2', 'G5.3', 'G5.4', 'G5.5', 'G5.6']) external(id, 'depende de aval, adaptador e agentes que não existem');

  const schemas = read(join(PKG_DIR, 'src/schemas.ts'));
  const sched = read(join(PKG_DIR, 'src/scheduler.ts'));
  set('G6.1', schemas.includes('ParticipantInputSchema') && sched.includes('class StoreInputCollector'), 'ParticipantInputSchema e StoreInputCollector');
  external('G6.2', 'o worker de digest não existe');
  set('G6.3', schedTest.includes('regra do silêncio'), 'scheduler.test.ts cobre status_only sem insumo com model_calls = 0');
  return out;
}
