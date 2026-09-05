async(page)=>{
 const a=await page.evaluate(()=>({started:!!window.__OCEAN_GAME__,state:window.__OCEAN_GAME__?.stabilitySnapshot().mode}));
 if(a.state==='TITLE'){await page.locator('#start-sailing').click();await page.waitForTimeout(600)}
 await page.evaluate(()=>{const a=window.__OCEAN_API__,g=window.__OCEAN_GAME__;a.questQa.prepare(1);g.audio.setMuted(true);g.applyReducedMotion(true);g.openKeeperDialogue(1)});
 await page.locator('#dialogue-start').click();
 let wrongDone=false,steps=0,seen=[];
 while(steps++<40){
  const q=await page.evaluate(()=>{const g=window.__OCEAN_GAME__,q=g.currentTrialProblem();return q?{...q,step:g.trialRuntime.sequenceStep,matched:[...g.trialRuntime.matchedIds],order:g.trialRuntime.order,index:g.trialSession.index}:null});
  if(!q)break;if(!seen.includes(q.type))seen.push(q.type);
  if(q.type==='symbol_matching'){
   const target=q.matchPairs.find(p=>!q.matched.includes(p.id));
   if(!target){await page.waitForTimeout(750);continue}
   await page.locator(`[data-target-id="${target.id}"]`).click();
   await page.locator(`#trial-choices [data-choice-id="${target.id}"]`).click();
  }else{
   const correct=q.answerSequence?q.answerSequence[q.step]:q.answerId;
   if(!wrongDone&&q.type!=='ordered_navigation'){
    const wrong=q.order.find(id=>id!==correct);await page.keyboard.press(String(q.order.indexOf(wrong)+1));wrongDone=true;await page.waitForTimeout(1350);continue;
   }
   await page.keyboard.press(String(q.order.indexOf(correct)+1));
  }
  await page.waitForTimeout(850);
 }
 const result=await page.evaluate(()=>({visible:!document.getElementById('trial-result').hidden,rows:document.querySelectorAll('.result-row').length,snapshot:window.__OCEAN_API__.trialQa.snapshot(),seen:document.getElementById('trial-result').innerText}));
 if(!result.visible)throw new Error('Result never appeared');
 await page.locator('.result-row button').first().click();await page.locator('.result-actions button').first().click();
 await page.waitForTimeout(150);const event=await page.evaluate(()=>({mode:window.__OCEAN_GAME__.stabilitySnapshot().mode,eventVisible:!document.getElementById('lighthouse-event').hidden}));
 await page.locator('#lighthouse-skip').click();
 return{types:seen,steps,wrongDone,result,event,after:await page.evaluate(()=>window.__OCEAN_API__.trialQa.snapshot())};
}
