// Entrada da correção de matéria da Fábrica (ADR-019 §c.5): rascunho corrigido + checagem + caso. Só zod (sem dependências de rota).
import { z } from 'zod';
import { ContentType, DataClass, EditoriaSlug } from '@ln/contracts';

const Str = (n: number) => z.string().min(1).max(n);
const Claim = z.strictObject({
  id: Str(64), text: Str(2000), kind: z.enum(['fact', 'number', 'quote', 'date']), evidenceIds: z.array(Str(128)).max(50),
  quote: z.strictObject({ text: Str(2000), speaker: Str(200) }).optional(),
});
const Basis = z.strictObject({ kind: z.enum(['license', 'authorization', 'public_domain', 'validated_exception']), reference: Str(300), registeredAt: Str(40), validatedBy: Str(128) });
const Image = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none'), reason: Str(500) }),
  z.strictObject({ mode: z.literal('source_image'), sourceId: Str(128), url: z.url().max(500), credit: Str(300), creditLink: z.url().max(500), basis: Basis.nullable(), alt: Str(500).optional() }),
  z.strictObject({
    mode: z.literal('conceptual'), url: z.url().max(500), alt: Str(500), generatedBy: Str(128), promptVersion: Str(64), promptSha256: Str(64),
    humanReview: z.strictObject({ reviewedBy: Str(128), at: Str(40), limitsConfirmed: z.literal(true) }).optional(),
  }),
]);
/** Rascunho corrigido (sem bloco "Avisos:": o sistema o compõe). */
export const DraftIn = z.strictObject({
  id: Str(128), editoria: EditoriaSlug, headline: Str(300), body: Str(100_000), slug: Str(120), resumo: Str(300), subtitulo: Str(300).optional(),
  tipoConteudo: ContentType, classeDeDado: DataClass, patrocinado: z.boolean(), rotuloPublieditorial: Str(200).optional(),
  claims: z.array(Claim).min(1).max(100), evidenceIds: z.array(Str(128)).max(50), signature: Str(100), image: Image, modelProvider: Str(64), promptVersion: Str(64),
});
export const CorrecaoIn = z.strictObject({
  casoId: Str(128),
  draft: DraftIn,
  factcheck: z.strictObject({
    provider: Str(64), model: Str(64), verdicts: z.array(z.strictObject({ claimId: Str(64), verdict: z.enum(['pass', 'fail', 'inconclusive']) })).max(200),
  }),
});
export type CorrecaoInput = z.output<typeof CorrecaoIn>;
