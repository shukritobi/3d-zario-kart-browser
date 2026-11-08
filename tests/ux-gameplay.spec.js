import {test,expect} from '@playwright/test';

test('main menu never scrolls, and advanced settings remain accessible',async ({page})=>{
  await page.goto('/?quality=low');
  await page.waitForFunction(()=>!!window.__sk3d,null,{timeout:80000});
  const card=page.locator('.sk3d-menu-card');
  await expect(page.locator('.sk3d-start-btn')).toBeVisible();
  await expect(page.locator('.zario-settings-toggle')).toBeVisible();
  await expect(page.locator('.zario-controls')).toBeHidden();
  const noScroll=await card.evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight,overflow:getComputedStyle(el).overflowY}));
  expect(noScroll.overflow).toBe('hidden');
  expect(noScroll.scroll).toBeLessThanOrEqual(noScroll.client+3);
  await page.locator('.zario-settings-toggle').click();
  await expect(page.locator('.zario-settings-panel')).toBeVisible();
  await expect(page.locator('.sk3d-cc-row')).toBeVisible();
  await page.locator('.zario-settings-close').click();
  await expect(page.locator('.zario-settings-panel')).toBeHidden();
});

test('portrait mobile asks for physical rotation without breaking rendering coordinates',async ({page})=>{
  await page.goto('/?quality=low');
  await page.waitForFunction(()=>!!window.__sk3d,null,{timeout:80000});
  const state=await page.evaluate(()=>{
    const el=document.querySelector('#app');
    return {w:el.clientWidth,h:el.clientHeight,bodyTransform:getComputedStyle(document.body).transform,
      pageOverflows:document.documentElement.scrollWidth>innerWidth+2||document.documentElement.scrollHeight>innerHeight+2};
  });
  if((await page.viewportSize()).width < (await page.viewportSize()).height){
    expect(state.h).toBeGreaterThan(state.w);
    expect(state.bodyTransform).toBe('none');
    await expect(page.locator('.zario-orientation-prompt')).toBeHidden();
    await page.evaluate(() => document.body.classList.add('zario-race-input'));
    await expect(page.locator('.zario-orientation-prompt')).toBeVisible();
    expect(state.pageOverflows).toBeFalsy();
  }
});

test('all four tracks load as playable length with three-lap race settings', async ({page},info)=>{
  test.skip(info.project.name!=='mobile-webkit','single platform avoids redundant 4-track GPU test');
  test.setTimeout(260000);
  for (const id of [1,2,3,4]) {
    await page.goto('/?track='+id+'&quality=low',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.__sk3d?.track?.length,null,{timeout:90000});
    const details=await page.evaluate(()=>({
      length:window.__sk3d.track.length,
      theme:window.__sk3d.track.themeId,
      boost:window.__sk3d.track.turboPads?.ts?.length||0,
      ramp:window.__sk3d.track.ramps?.length||0,
      graphics:window.__zarioPerformance().profile
    }));
    expect(details.theme).toBe(id);
    expect(details.length).toBeGreaterThan(930);
    expect(details.length).toBeLessThan(2100);
    expect(details.boost).toBeGreaterThanOrEqual(3);
    expect(details.ramp).toBeGreaterThanOrEqual(1);
    expect(details.graphics).toBeTruthy();
  }
});

test('shells and bananas survive after spawning midway round a course',async ({page},info)=>{
  test.skip(info.project.name!=='mobile-webkit','single heavyweight WebGL gameplay check');
  test.setTimeout(200000);
  await page.goto('/?track=3&quality=low&test',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__sk3d?.playerKart()?.state,null,{timeout:100000});
  await page.evaluate(()=>window.__sk3d.skipCountdown());
  const results=await page.evaluate(()=>{
    const api=window.__sk3d,player=api.playerKart(),rm=api.raceManager;
    // Move the player to a representative location far from start.
    const pos=api.track.path.getPointAt(.58),tan=api.track.path.getTangentAt(.58);
    player.state.position.copy(pos);
    player.state.heading=Math.atan2(tan.x,tan.z);
    player.group.position.copy(pos);
    const results={};
    for(const [type,label] of [['red_shell','red'],['banana','banana']]){
      player.heldItem=type;
      rm.useItem(player);
      const item=rm.activeItems[rm.activeItems.length-1];
      if(!item)throw new Error(label+' did not instantiate');
      results[label]={spawnIndex:item._nearIdx,aliveAtSpawn:!item.dead};
      item.update(.16,rm.karts);
      results[label].aliveAfterUpdate=!item.dead;
    }
    return results;
  });
  expect(results.red.aliveAtSpawn).toBe(true);
  expect(results.red.aliveAfterUpdate).toBe(true);
  expect(results.red.spawnIndex).toBeGreaterThan(50);
  expect(results.banana.aliveAtSpawn).toBe(true);
  expect(results.banana.aliveAfterUpdate).toBe(true);
  expect(results.banana.spawnIndex).toBeGreaterThan(50);
});
