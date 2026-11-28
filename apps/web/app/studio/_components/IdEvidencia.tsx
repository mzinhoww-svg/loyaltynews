/** O ID da evidência, para copiar: a correção aceita pede a afirmação com ele. */
export function IdEvidencia({ id }: { id: string }) {
  return (
    <span className="st-hint" style={{ display: 'block', overflowWrap: 'anywhere' }}>
      ID da evidência: <code data-id-evidencia={id}>{id}</code>
    </span>
  );
}
