import Link from 'next/link';
import { EDITORIAS } from '../_lib/editorias';
import { flags } from '../_lib/flags';
import { getSource } from '../_lib/source';
import { SITE_TAGLINE } from '../_lib/site';

export async function SiteFooter() {
  const trending = (await getSource().getTrending('7d')).slice(0, 3);
  const year = new Date().getFullYear();
  return (
    <footer className="ln-footer" aria-label="Rodapé">
      <div className="ln-wrap">
        <div className="ln-footer-grid">
          <div>
            <div className="ln-footer-brand">
              loyalty<span>news.</span>
            </div>
            <p>{SITE_TAGLINE}. Notícias, análises e tendências sobre programas, pagamentos, consumo e relacionamento.</p>
          </div>
          <div>
            <h2>Notícias em alta</h2>
            {trending.length ? (
              <ul>
                {trending.map((a) => (
                  <li key={a.slug}>
                    <Link href={`/noticia/${a.slug}`}>{a.title}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Em breve: primeiras matérias.</p>
            )}
          </div>
          <div>
            <h2>Editorias</h2>
            <ul>
              {EDITORIAS.slice(0, 5).map((e) => (
                <li key={e.slug}>
                  <Link href={`/editoria/${e.slug}`}>{e.name}</Link>
                </li>
              ))}
              <li>
                <Link href="/noticias">Todas as editorias</Link>
              </li>
            </ul>
          </div>
          <div>
            <h2>Informações</h2>
            <ul>
              <li><Link href="/sobre">Sobre</Link></li>
              <li><Link href="/metodologia">Metodologia</Link></li>
              <li><Link href="/politica-editorial">Política editorial</Link></li>
              <li><Link href="/correcoes">Direitos, créditos e correções</Link></li>
              <li><Link href="/privacidade">Privacidade e LGPD</Link></li>
              <li><Link href="/termos">Termos de uso</Link></li>
              <li><Link href="/publicidade">Política de publicidade</Link></li>
            </ul>
          </div>
          <div>
            <h2>Contato</h2>
            <ul>
              <li><Link href="/contato">Fale conosco</Link></li>
              <li><Link href="/midia-kit">Anuncie · Mídia kit</Link></li>
              <li><Link href="/intelligence">Loyalty Intelligence</Link></li>
              {flags.theLoyal && <li><Link href="/the-loyal">The Loyal</Link></li>}
            </ul>
            <p style={{ marginTop: 12, fontSize: 13 }}>Canais oficiais e e-mail serão publicados quando confirmados.</p>
          </div>
        </div>
        <div className="ln-copy">© {year} Loyalty News. Todos os direitos reservados.</div>
      </div>
    </footer>
  );
}
