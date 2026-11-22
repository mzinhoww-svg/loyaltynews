/**
 * Carga tipada dos contratos v2.1. Os JSON em `data/` são cópias byte a byte dos contratos
 * (ver `data/SOURCES.json`, com sha256 de origem). Qualquer divergência de formato falha aqui,
 * na validação zod, antes de qualquer uso.
 */
import agentsRaw from '../data/agents.registry.json';
import workflowsRaw from '../data/workflows.registry.json';
import meetingsRaw from '../data/meetings.registry.json';
import routesRaw from '../data/routes.json';
import {
  AgentsRegistrySchema,
  MeetingsRegistrySchema,
  WorkflowsRegistrySchema,
  type AgentProfile,
  type Meeting,
  type RecoveryPolicy,
  type Workflow,
} from './schemas';

export interface RawRegistries {
  agents: unknown;
  workflows: unknown;
  meetings: unknown;
}

export interface LoadedRegistries {
  agents: AgentProfile[];
  workflows: Workflow[];
  meetings: Meeting[];
  recoveryPolicy: RecoveryPolicy;
  meetingsVersion: string;
}

/** Valida e tipa registros brutos (usado também pelos testes com dados adulterados). */
export function parseRegistries(raw: RawRegistries): LoadedRegistries {
  const agents = AgentsRegistrySchema.parse(raw.agents);
  const workflows = WorkflowsRegistrySchema.parse(raw.workflows);
  const meetings = MeetingsRegistrySchema.parse(raw.meetings);
  return {
    agents: agents.agents,
    workflows: workflows.workflows,
    meetings: meetings.meetings,
    recoveryPolicy: meetings.recovery_policy,
    meetingsVersion: meetings.version,
  };
}

export function loadRegistries(): LoadedRegistries {
  return parseRegistries({ agents: agentsRaw, workflows: workflowsRaw, meetings: meetingsRaw });
}

/** Rotas válidas segundo `contracts/model.policy.json` (somente os nomes). */
export const POLICY_ROUTES: readonly string[] = routesRaw.routes;
