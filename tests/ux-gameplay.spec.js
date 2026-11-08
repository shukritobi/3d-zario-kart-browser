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
  await expect(page.locator('.zario-controls')).toBeVisible();
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


test('iPhone landscape menu has separated actions and race HUD stays near edges',async({page},info)=>{
  test.skip(info.project.name==='ipad-landscape-webkit','iPhone only');
  test.setTimeout(140000);
  await page.setViewportSize({width:844,height:390});
  await page.goto('/?track=3&quality=low');
  await page.waitForFunction(()=>!!window.__sk3d,null,{timeout:90000});
  const getRect=async s=>page.locator(s).boundingBox();
  const [start,racers,tracks,pick,settings]=await Promise.all(
    ['.sk3d-start-btn','.sk3d-racers-btn','.sk3d-tracks-btn',
     '.sk3d-current-pick','.zario-settings-toggle'].map(getRect));
  for(const rect of [start,racers,tracks,pick,settings])expect(rect).toBeTruthy();
  expect(racers.x+racers.width).toBeLessThan(tracks.x+3);
  expect(start.y+start.height).toBeLessThan(racers.y+4);
  expect(racers.y+racers.height).toBeLessThan(pick.y+3);
  expect(pick.y+pick.height).toBeLessThan(settings.y+4);
  // A race menu must not hide its settings beneath a clipped container.
  const container=await page.locator('.sk3d-menu-card').evaluate(el=>({
    scroll:el.scrollHeight,client:el.clientHeight,
  }));
  expect(container.scroll).toBeLessThanOrEqual(container.client+3);
  await page.locator('.sk3d-start-btn').click();
  await page.waitForFunction(()=>window.__sk3d?.playerKart()?.state,null,{timeout:90000});
  await page.evaluate(()=>window.__sk3d.skipCountdown());
  await expect(page.locator('.sk3d-hud')).toBeVisible();
  await expect(page.locator('body > .zario-controls')).toHaveCount(0);
  const [map,speedo,lap,steer,item]=await Promise.all(
    ['.sk3d-minimap','.sk3d-speedo','.sk3d-lap','.sk3d-touch-left',
     '.sk3d-touch-item'].map(getRect));
  for(const r of [map,speedo,lap,steer,item])expect(r).toBeTruthy();
  expect(map.width).toBeLessThan(90);
  expect(speedo.width).toBeLessThan(110);
  expect(lap.x+lap.width).toBeLessThan(map.x);
  expect(steer.x+steer.width).toBeLessThan(item.x);
  expect(steer.y).toBeGreaterThan(speedo.y+speedo.height);
  // Moved gyroscope controls can never cover the visible race road.
  await expect(page.locator('.zario-settings-panel')).toBeHidden();
});

test('item box pickup creates shards and a flying ammo indicator',async({page},info)=>{
  test.skip(info.project.name!=='mobile-webkit','run one in-scene WebKit check');
  test.setTimeout(150000);
  await page.setViewportSize({width:844,height:390});
  await page.goto('/?track=1&quality=low&test',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__sk3d?.playerKart()?.state,null,{timeout:90000});
  await page.locator('.sk3d-start-btn').click();
  await page.waitForFunction(()=>window.__sk3d?.playerKart()?.state,null,{timeout:90000});
  await page.evaluate(()=>window.__sk3d.skipCountdown());
  const result=await page.evaluate(()=>{
    const api=window.__sk3d;
    const rm=api.raceManager,player=api.playerKart();
    const box=rm.itemBoxes[0];
    player.heldItem=null;player.heldItem2=null;
    player.state.position.copy(box.mesh.position);
    player.group.position.copy(box.mesh.position);
    box.update(0.016,[player],rm);
    const state={boxActive:box.active,shards:box._shatter?.mesh?.count||0,
      fly:!!document.querySelector('.zario-item-fly'),held:!!player.heldItem};
    box._clearShatter();
    return state;
  });
  expect(result.boxActive).toBe(false);
  expect(result.shards).toBe(12);
  expect(result.fly).toBe(true);
  expect(result.held).toBe(true);
});
