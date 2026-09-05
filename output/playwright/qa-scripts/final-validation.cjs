async(page)=>{
 await page.locator('#start-sailing').click();await page.waitForTimeout(700);
 const loop=async(count)=>{for(let i=0;i<count;i++){await page.evaluate(i=>{const a=window.__OCEAN_API__,g=window.__OCEAN_GAME__;g.openCodex();g.showCodexDetail(a.TERMS.find(t=>t.region===1));g.closeCodex();g.openPause();g.showMenuTab('settings');g.showMenuTab('controls');g.closePause();if(i<20){g.startRegionTrial(1);g.exitTrial()}},i);await page.waitForTimeout(60)}};
 await page.evaluate(()=>{const a=window.__OCEAN_API__,g=window.__OCEAN_GAME__;a.questQa.prepare(1);g.audio.setMuted(true);g.applyReducedMotion(true)});
 await loop(2);await page.waitForTimeout(4000);const before=await page.evaluate(()=>window.__OCEAN_GAME__.setStabilityBaseline('final-ui-warm'));
 await loop(50);for(let i=0;i<20;i++){await page.setViewportSize(i%2?{width:1440,height:900}:{width:844,height:390});await page.waitForTimeout(50)}
 await page.waitForTimeout(4000);
 const after=await page.evaluate(()=>({delta:window.__OCEAN_GAME__.stabilityDelta(),render:window.__OCEAN_GAME__.renderer.info.render,ui:{average:window.__OCEAN_GAME__.ux.uiTotal/window.__OCEAN_GAME__.ux.uiSamples,max:window.__OCEAN_GAME__.ux.uiMax},isolation:window.__OCEAN_API__.journeyQa.verifyIsolation()}));
 await page.evaluate(result=>{window.__UX_VALIDATION_PARTIAL__=result;const g=window.__OCEAN_GAME__;g.motion.x=120;g.motion.z=-500}, {before,after});await page.waitForTimeout(500);await page.setViewportSize({width:390,height:844});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:3});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:400,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(80);
 const stick=await page.locator('#joystick').boundingBox(),camera=await page.locator('#camera-pad').boundingBox();
 const a={x:Math.round(stick.x+stick.width/2),y:Math.round(stick.y+stick.height/2),id:1},b={x:Math.round(camera.x+camera.width/2),y:Math.round(camera.y+camera.height/2),id:2};
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a,b]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,y:a.y-25},{...b,x:b.x+20}]});
 const held=await page.evaluate(()=>window.__OCEAN_API__.phase8Qa.input());await page.locator('#action-main').click();const heldAfter=await page.evaluate(()=>window.__OCEAN_API__.phase8Qa.input());
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const released=await page.evaluate(()=>window.__OCEAN_API__.phase8Qa.input());
 await page.screenshot({path:'output/playwright/ux_U7_touch_390x844_after.png'});
 await page.evaluate(()=>{window.__OCEAN_GAME__.openPause();window.__OCEAN_GAME__.showMenuTab('settings')});await page.locator('button[data-text-scale="1.3"]').click();await page.locator('#menu-close').click();
 await page.keyboard.press('b');await page.locator('.codex-card .card-open').first().click();const focus=[];for(let i=0;i<18;i++){await page.keyboard.press('Tab');focus.push(await page.evaluate(()=>document.getElementById('codex-detail').contains(document.activeElement)))}
 await page.screenshot({path:'output/playwright/ux_U7_focus_scale1.3_390x844_after.png'});await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 return{before,after,touch:{held,heldAfter,released,targets:await page.evaluate(()=>window.__OCEAN_API__.measureTouchTargets())},focusTrap:focus.every(Boolean)};
}
