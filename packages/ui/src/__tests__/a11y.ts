import { axe } from "vitest-axe";
import { expect } from "vitest";

// jsdom não calcula estilos: color-contrast fica de fora aqui. Contraste é coberto por
// contrast.test.ts (pares de tokens) e pela auditoria axe no navegador real (showcase ?axe).
const options = { rules: { "color-contrast": { enabled: false } } };

/** Falha listando regra + trechos quando o axe encontra violações (WCAG 2.x A/AA + boas práticas). */
export async function expectNoViolations(container: Element): Promise<void> {
  const result = await axe(container, options);
  expect(result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.html.slice(0, 80)).join(" | ")}`)).toEqual([]);
}
