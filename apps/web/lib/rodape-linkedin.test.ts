import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteFooter } from '../app/(portal)/_components/SiteFooter';

// Decisão do proprietário (27/11): o rodapé mostra só o LinkedIn.
const URL_LINKEDIN = 'https://www.linkedin.com/company/loyalty-news';
const html = async () => renderToStaticMarkup((await SiteFooter()) as ReactElement);
const links = (h: string) => [...h.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
const redes = /linkedin\.com|instagram\.com|wa\.me|facebook\.com|twitter\.com|(?<![a-z])x\.com|youtube\.com|tiktok\.com|threads\.net|t\.me\//i;

describe('rodapé: só o LinkedIn', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('tem um único link de rede social: o da página da Loyalty News, em nova aba', async () => {
    const sociais = links(await html()).filter((a) => redes.test(a));
    expect(sociais).toHaveLength(1);
    expect(sociais[0]).toContain(`href="${URL_LINKEDIN}"`);
    expect(sociais[0]).toContain('target="_blank"');
    expect(sociais[0]).toContain('rel="noopener noreferrer"');
    expect(sociais[0]).toMatch(/text-decoration:underline/);
  });

  it('o nome acessível começa pelo texto visível e diz de quem é e que abre em nova aba', async () => {
    expect(await html()).toMatch(/Siga no <a [^>]*>LinkedIn<span class="pt-sr"> da Loyalty News \(abre em nova aba\)<\/span><\/a>\./);
  });

  it('a frase antiga sai; razão social, CNPJ e contato continuam', async () => {
    const h = await html();
    expect(h).not.toMatch(/Redes oficiais|quando confirmadas/i);
    expect(h).toMatch(/CNPJ [\d./-]{14,}\. Contato comercial e de dados: contato@loyaltynews\.com\.br\. Siga no /);
  });
});
