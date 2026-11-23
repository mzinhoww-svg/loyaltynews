export function Flash({ tipo, aviso }: { tipo?: string; aviso?: string }) {
  if (!aviso) return null;
  const erro = tipo === 'err';
  return (
    <div className={`st-alert ${erro ? 'err' : 'ok'}`} role={erro ? 'alert' : 'status'}>
      {aviso}
    </div>
  );
}

export function SemBackend({ children }: { children: React.ReactNode }) {
  return <p className="st-hint">{children} Armazenamento temporário (sem backend): os dados somem ao reiniciar o servidor.</p>;
}
