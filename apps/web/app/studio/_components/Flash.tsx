/** Link do próximo passo: só caminho interno do Studio (nunca URL externa nem `//`); o texto sai do destino. */
function proximoLink(proximo?: string): { href: string; texto: string } | null {
  if (!proximo || !/^\/studio\/[A-Za-z0-9/_.-]*$/.test(proximo) || proximo.includes('//') || proximo.includes('..')) return null;
  if (/^\/studio\/fontes\/[^/]+$/.test(proximo)) return { href: proximo, texto: 'Abrir a fonte no Banco de fontes' };
  if (proximo === '/studio/fontes') return { href: proximo, texto: 'Ir ao Banco de fontes' };
  return null;
}

export function Flash({ tipo, aviso, proximo }: { tipo?: string; aviso?: string; proximo?: string }) {
  if (!aviso) return null;
  const erro = tipo === 'err';
  const link = proximoLink(proximo);
  return (
    <div className={`st-alert ${erro ? 'err' : 'ok'}`} role={erro ? 'alert' : 'status'}>
      {aviso}
      {link ? (
        <>
          {' '}
          <a href={link.href} data-proximo>
            {link.texto}
          </a>
        </>
      ) : null}
    </div>
  );
}

export function SemBackend({ children }: { children: React.ReactNode }) {
  return <p className="st-hint">{children} Armazenamento temporário (sem backend): os dados somem ao reiniciar o servidor.</p>;
}
