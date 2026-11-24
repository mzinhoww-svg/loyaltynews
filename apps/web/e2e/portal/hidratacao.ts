import type { Locator, Page } from '@playwright/test';

/**
 * Espera a hidratação do App Router: `window.next.router` só vira objeto depois que o React hidratou a página
 * (o HTML do servidor já traz as regiões, mas foco e eventos de cliente só valem depois disso).
 * Sinal determinístico, sem tempo fixo e sem repetir a ação.
 */
export async function aguardarHidratacao(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof (window as unknown as { next?: { router?: unknown } }).next?.router === 'object');
}

/** Foca o elemento e lê, no MESMO instante dentro da página, se ficou focado e qual é o anel de foco: nada acontece entre o foco e a leitura. */
export function focarELer(el: Locator): Promise<{ focado: boolean; estiloAnel: string; larguraAnel: number }> {
  return el.evaluate((n) => {
    (n as HTMLElement).focus();
    const s = getComputedStyle(n);
    return { focado: n === document.activeElement, estiloAnel: s.outlineStyle, larguraAnel: parseFloat(s.outlineWidth) };
  });
}
