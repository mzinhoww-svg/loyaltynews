// MOCK — dados fictícios apenas para teste. Nunca apresentar como dado real nem homologado.
// Nomes e URLs são inventados (domínio .invalid); nenhuma pessoa real.
import type { EvidenceInput } from '../src/types';

export const MOCK_LABEL = 'MOCK';

export const mockEvidence = (slug: string, retrievedAt = '2026-11-01T12:00:00Z'): EvidenceInput => ({
  sourceUrl: `https://mock.invalid/${slug}`,
  sourceName: `MOCK fonte pública ${slug}`,
  retrievedAt,
  excerpt: `MOCK trecho de ${slug}`,
  isMock: true,
});

export const MOCK_ORGS = {
  alfa: 'MOCK Alfa Fidelidade S.A.',
  beta: 'MOCK Beta Cartões Ltda',
  gama: 'MOCK Gama Varejo S.A.',
  delta: 'MOCK Delta Travel Ltda',
} as const;

export const MOCK_PEOPLE = {
  ana: { name: 'MOCK Ana Exemplo', profile: 'https://mock.invalid/perfil/ana' },
  bruno: { name: 'MOCK Bruno Exemplo', profile: 'https://mock.invalid/perfil/bruno' },
  carla: { name: 'MOCK Carla Exemplo', profile: 'https://mock.invalid/perfil/carla' },
  diego: { name: 'MOCK Diego Exemplo', profile: 'https://mock.invalid/perfil/diego' },
} as const;
