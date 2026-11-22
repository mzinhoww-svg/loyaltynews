// Organização agêntica no Studio: registros oficiais (64 perfis, 19 workflows, 28 rituais) carregados e validados por
// @ln/agents. É configuração versionada, não dado simulado. Execuções (atas, decisões) só existem depois que os rituais
// rodam (flag rituais, desligada): o store começa vazio.
import { InMemoryStore, buildOrganization, createBrCalendar, loadRegistries, type Organization } from '@ln/agents';
import { singleton } from './registros';

export const getOrganizacao = (): Organization => singleton('org-agentica', () => buildOrganization(loadRegistries()));
export const getStoreAgentes = () => singleton('org-store', () => new InMemoryStore());
export const getCalendarioBr = () => singleton('cal-br', () => createBrCalendar());
