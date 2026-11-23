// MOCK — matéria "publicada" e pacote social da Fábrica editorial, tipados com os tipos REAIS de @ln/editorial
// (`ArticleRecord`, `SocialPack`): se o contrato da Fábrica mudar, este arquivo deixa de compilar. Dados de TESTE.
import type { ArticleRecord, SocialPack } from '@ln/editorial';

export function mockPublishedRecord(over: Partial<ArticleRecord> = {}): ArticleRecord {
  return {
    articleId: 'MOCK-2026-0001',
    editoria: 'programas',
    status: 'publicado',
    draft: {
      id: 'MOCK-2026-0001',
      editoria: 'programas',
      headline: 'MOCK: Programa Exemplo muda regra de validade dos pontos',
      body: 'Corpo de demonstração (MOCK).',
      slug: 'mock-programa-exemplo-muda-regra',
      resumo: 'Texto de demonstração; não descreve nenhum programa real.',
      tipoConteudo: 'noticia',
      classeDeDado: 'public',
      patrocinado: false,
      claims: [
        { id: 'c1', text: 'O Programa Exemplo passa a ter validade de 24 meses para os pontos (dado de teste).', kind: 'fact', evidenceIds: ['ev1'] },
        { id: 'c2', text: 'A mudança vale a partir de 1 de janeiro (dado de teste).', kind: 'date', evidenceIds: ['ev1'] },
        { id: 'c3', text: 'Afirmação reprovada que cita 99 mil clientes (dado de teste).', kind: 'number', evidenceIds: ['ev2'] },
        { id: 'c4', text: 'Citação literal de teste.', kind: 'quote', evidenceIds: ['ev1'], quote: { text: 'Citação literal de teste.', speaker: 'Fonte de teste' } },
        { id: 'c5', text: 'Afirmação sem evidência (dado de teste).', kind: 'fact', evidenceIds: [] },
      ],
      evidenceIds: ['ev1', 'ev2'],
      signature: 'Redação Loyalty News',
      image: { mode: 'conceptual', url: 'https://example.invalid/ilustracao.png', alt: 'Ilustração conceitual de teste', generatedBy: 'teste', promptVersion: 'p1', promptSha256: 'a'.repeat(64) },
      modelProvider: 'anthropic',
      promptVersion: 'p1',
    },
    evidences: [],
    factcheck: {
      provider: 'openai',
      model: 'checker-de-teste',
      verdicts: [
        { claimId: 'c1', verdict: 'pass' },
        { claimId: 'c2', verdict: 'pass' },
        { claimId: 'c3', verdict: 'fail' },
        { claimId: 'c4', verdict: 'pass' },
        { claimId: 'c5', verdict: 'pass' },
      ],
    },
    blockers: [],
    findings: [],
    reviews: [],
    recheckCount: 0,
    updatedAt: '2026-11-23T12:00:00.000Z',
    publication: {
      receiptId: 'rcpt-mock-1',
      url: 'https://example.invalid/materias/mock-programa-exemplo-muda-regra',
      publishedAt: '2026-11-23T12:00:00.000Z',
      contentSha256: 'b'.repeat(64),
      isMock: true,
    },
    ...over,
  };
}

export function mockSocialPack(over: Partial<SocialPack> = {}): SocialPack {
  return {
    articleId: 'MOCK-2026-0001',
    linkedin: {
      text: 'Texto livre do modelo (não usado como fonte do rascunho).\n\nhttps://example.invalid/materias/mock-programa-exemplo-muda-regra?utm_source=linkedin&utm_medium=social&utm_campaign=materia-MOCK-2026-0001',
      url: 'https://example.invalid/materias/mock-programa-exemplo-muda-regra?utm_source=linkedin&utm_medium=social&utm_campaign=materia-MOCK-2026-0001',
      utm: { source: 'linkedin', medium: 'social', campaign: 'materia-MOCK-2026-0001' },
    },
    image: { mode: 'conceptual', label: 'Ilustração conceitual' },
    mentions: [],
    blockers: [],
    ...over,
  };
}
