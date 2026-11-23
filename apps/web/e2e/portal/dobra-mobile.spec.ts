import { test, expect } from '@playwright/test';
// int/014: so roda no modo MOCK do portal (precisa de manchetes); no e2e geral e nos outros modos nao ha conteudo, como nos demais specs desta pasta.
test.skip(process.env.PORTAL_MODE !== 'mock', 'somente com PORTAL_MODE=mock');
for(const [width,height] of [[390,844],[375,812]]){
test('V-11 em '+width+'x'+height, async({page})=>{
 await page.setViewportSize({width,height});
 await page.goto('/');
 await page.evaluate(()=>document.fonts.ready);
 const boxes=await page.locator('main .ln-card__title').evaluateAll(nodes=>nodes.map(n=>[n.getBoundingClientRect().top,n.getBoundingClientRect().bottom]));
 const visible=boxes.filter(([top,bottom])=>top>=0 && bottom<=height).length;
 console.log({width,height,visible,quarta:boxes[3]});
 expect(visible).toBeGreaterThanOrEqual(4);
});
}
