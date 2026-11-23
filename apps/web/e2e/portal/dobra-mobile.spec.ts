import { test, expect } from '@playwright/test';
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
