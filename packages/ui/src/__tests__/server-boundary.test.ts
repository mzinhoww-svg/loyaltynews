import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Next 16 (App Router): módulo que usa hooks/contexto/portal precisa de "use client".
// Os demais componentes devem permanecer utilizáveis em Server Components (sem a diretiva e sem hooks).
const root = resolve(__dirname, "..", "components");
const CLIENT_API = /\b(useState|useEffect|useLayoutEffect|useRef|useId|useMemo|useCallback|useContext|useReducer|createContext|createPortal)\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("fronteira cliente/servidor dos componentes", () => {
  const files = walk(root).map((p) => ({ rel: relative(root, p).replace(/\\/g, "/"), src: readFileSync(p, "utf8") }));
  const uses = (src: string) => CLIENT_API.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""));

  it("todo componente que usa hooks/contexto/portal começa com 'use client'", () => {
    const missing = files.filter((f) => uses(f.src) && !f.src.startsWith('"use client"')).map((f) => f.rel);
    expect(missing).toEqual([]);
  });
  it("componentes sem hooks NÃO levam 'use client' (seguem utilizáveis no servidor)", () => {
    const needless = files.filter((f) => !uses(f.src) && f.src.startsWith('"use client"')).map((f) => f.rel);
    expect(needless).toEqual([]);
  });
  it("lista dos componentes de cliente é a esperada", () => {
    const client = files.filter((f) => f.src.startsWith('"use client"')).map((f) => f.rel).sort();
    expect(client).toEqual([
      "FooterGroup.tsx",
      "Header.tsx",
      "HeaderSearch.tsx",
      "Input.tsx",
      "studio/DataTable.tsx",
      "studio/Form.tsx",
      "studio/Modal.tsx",
      "studio/Sidebar.tsx",
      "studio/Tabs.tsx",
      "studio/Toast.tsx",
    ]);
  });
});
