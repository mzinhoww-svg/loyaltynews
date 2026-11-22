// MOCK — matéria de demonstração para testes e amostras. NÃO é matéria real nem dado de mercado.
import type { Article } from '../src/types';

export const MOCK_ARTICLE: Article = {
  id: 'MOCK-2026-0001',
  title: 'MOCK: Programa Exemplo muda regra de validade dos pontos',
  deck: 'Texto de demonstração; não descreve nenhum programa real.',
  editoria: 'Programas de Fidelidade',
  url: 'https://example.invalid/materias/mock-2026-0001',
  facts: [
    { text: 'O Programa Exemplo passa a ter validade de 24 meses para os pontos (dado de teste).', source: 'fixture://mock/fato-1' },
    { text: 'A mudança vale a partir de 1 de janeiro (dado de teste).', source: 'fixture://mock/fato-2' },
  ],
  entities: [
    {
      name: 'Empresa Exemplo',
      kind: 'company',
      verified: {
        ref: 'urn:li:organization:MOCK-0000',
        source: 'fixture://mock/pagina-oficial',
        verifiedAt: '2026-11-22T00:00:00Z',
      },
    },
    { name: 'Pessoa Exemplo', kind: 'person' },
  ],
  approvedImage: { ref: 'fixture://mock/imagem-aprovada', credit: 'Ilustração Loyalty News (demonstrativa)' },
  gatesPassed: true,
  mock: true,
};
