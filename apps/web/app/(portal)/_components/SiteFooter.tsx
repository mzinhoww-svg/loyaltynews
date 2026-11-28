import { Footer } from '@ln/ui';
import Link from 'next/link';
import { EDITORIAS } from '../_lib/editorias';
import { flags } from '../_lib/flags';
import { getSource } from '../_lib/source';
import { indexingBlocked } from '../_lib/indexing';
import { LinkPreferenciasCookies } from '../_consentimento/Consentimento';
import { EMPRESA } from '../_lib/contato';
import type { SiteMenuItem } from '../_lib/types';

/**
 * Footer do design system (logo, frase institucional, editorias) + grupos de links.
 * Redes sociais: só o LinkedIn, por enquanto (decisão do proprietário, 27/11). Outra rede só entra com nova decisão e URL oficial
 * confirmada (nada inventado).
 */
const LINKEDIN_URL = 'https://www.linkedin.com/company/loyalty-news';

/** Grupos do rodapé publicados no Studio: item com `filhos` = grupo (título + links); itens soltos viram o grupo "Links". */
function publishedGroups(items: readonly SiteMenuItem[]) {
  const groups = items.filter((i) => i.children.length > 0).map((i) => ({ title: i.label, links: i.children.map((c) => ({ label: c.label, href: c.href })) }));
  const loose = items.filter((i) => i.children.length === 0).map((i) => ({ label: i.label, href: i.href }));
  return loose.length ? [{ title: 'Links', links: loose }, ...groups] : groups;
}

export async function SiteFooter() {
  const site = await getSource().getSiteConfig();
  const published = site?.menus.footer ? publishedGroups(site.menus.footer) : null;
  return (
    <Footer
      editorias={EDITORIAS.map((e) => ({ slug: e.slug, nome: e.name }))}
      hrefFor={(slug) => `/editoria/${slug}`}
      linkAs={Link}
      entrar={{ href: '/studio/entrar', label: 'Entrar' }}
      groups={published ?? [
        {
          title: 'Conteúdo',
          links: [
            { label: 'Últimas notícias', href: '/noticias' },
            { label: 'Em alta', href: '/em-alta' },
            { label: 'Loyalty Flash', href: '/flash' },
            { label: 'Análises', href: '/analises' },
            { label: 'Entrevistas', href: '/entrevistas' },
            { label: 'Agenda', href: '/agenda' },
            { label: 'Moves', href: '/moves' },
            { label: 'Loyalty Intelligence', href: '/intelligence' },
            ...(flags.theLoyal ? [{ label: 'The Loyal', href: '/the-loyal' }] : []),
          ],
        },
        {
          title: 'Institucional',
          links: [
            { label: 'Sobre', href: '/sobre' },
            { label: 'Metodologia', href: '/metodologia' },
            { label: 'Política editorial', href: '/politica-editorial' },
            { label: 'Direitos, créditos e correções', href: '/correcoes' },
            { label: 'Privacidade e LGPD', href: '/privacidade' },
            { label: 'Termos de uso', href: '/termos' },
            { label: 'Política de publicidade', href: '/publicidade' },
          ],
        },
        {
          title: 'Contato',
          links: [
            { label: 'Fale conosco', href: '/contato' },
            { label: 'Anuncie · Mídia kit', href: '/midia-kit' },
          ],
        },
      ]}
      note={
        <>
          {EMPRESA.razaoSocial} · CNPJ {EMPRESA.cnpj}. Contato comercial e de dados: contato@loyaltynews.com.br. Siga no{' '}
          <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', color: 'inherit' }} data-testid="footer-linkedin">
            LinkedIn<span className="pt-sr"> da Loyalty News (abre em nova aba)</span>
          </a>.
          {/* Só onde a medição existe (produção indexável com o ID do GA4): reabre o aviso para mudar ou revogar a escolha (LGPD). */}
          {!indexingBlocked() && process.env.NEXT_PUBLIC_GA_ID ? <> · <LinkPreferenciasCookies /></> : null}
        </>
      }
    />
  );
}
