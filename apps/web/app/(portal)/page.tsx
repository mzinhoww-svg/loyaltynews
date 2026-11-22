import { EDITORIAS } from '@ln/contracts';

// Placeholder do scaffold. A home real é da Frente 03 (LN Frontend Engineer).
export default function HomePage() {
  return (
    <main>
      <h1>Loyalty News</h1>
      <p>Portal em construção.</p>
      <nav aria-label="Editorias">
        <ul>
          {EDITORIAS.map((e) => (
            <li key={e.slug}>{e.nome}</li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
