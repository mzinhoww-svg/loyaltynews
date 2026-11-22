// Gera amostras (SVG + HTML) a partir da matéria MOCK em out/samples/. Não publica nada.
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderPost, type Format } from '../src/creative/post.ts';
import { buildLinkedInPackage } from '../src/package/linkedin.ts';
import { MOCK_ARTICLE } from '../fixtures/article.mock.ts';

const out = new URL('../out/samples/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const f of ['vertical', 'square', 'story', 'open_graph'] as Format[]) {
  const a = renderPost(MOCK_ARTICLE, { format: f });
  writeFileSync(new URL(`${f}.svg`, out), a.svg);
  writeFileSync(new URL(`${f}.html`, out), a.html);
}
const pkg = buildLinkedInPackage(MOCK_ARTICLE);
writeFileSync(new URL('linkedin-package.json', out), JSON.stringify({ ...pkg, creative: { ...pkg.creative, svg: '(ver vertical.svg)', html: '(ver vertical.html)' } }, null, 2));
console.log('amostras em', out.pathname);
