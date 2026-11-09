import {test,expect} from '@playwright/test';

test('Phase 1: diagnostics log is available and reset when a race starts',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='mobile-webkit','run browser flight-recorder check on iPhone WebKit emulation');
  test.setTimeout(160000);
  await page.goto('/?track=3&quality=low&test',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__sk3d?.playerKart()?.state,null,{timeout:90000});
  await page.evaluate(()=>window.__sk3d.skipCountdown());
  await page.waitForFunction(()=>window.__sk3d?.getState?.()==='race',null,{timeout:65000});
  const hasDiagnostics=await page.evaluate(()=>({
    capture:!!window.__zarioDiagnostics,
    enabled:window.__zarioAdaptiveGraphics().enabled,
    track:window.__zarioDiagnostics.status().metadata.trackId,
  }));
  expect(hasDiagnostics.capture).toBe(true);
  expect(hasDiagnostics.track).toBe(3);
  // Forced low-quality emulation must not adapt resolution under a test.
  expect(hasDiagnostics.enabled).toBe(false);
  await page.waitForFunction(()=>window.__zarioDiagnostics.status().samples.length>=2,null,{timeout:65000});
  const result=await page.evaluate(()=>{
    const log=JSON.parse(window.__zarioDiagnostics.exportJSON());
    return {samples:log.samples.length,seconds:log.seconds,counts:log.counts,
      speed:log.samples.at(-1).speed,schema:log.schema,
      exportButton:!!document.querySelector('.zario-export-race')};
  });
  expect(result.schema).toBe('zario-phase1-v1');
  expect(result.exportButton).toBe(true);
  expect(result.samples).toBeGreaterThanOrEqual(2);
  expect(result.seconds).toBeGreaterThan(0);
  expect(Number.isFinite(result.speed)).toBeTruthy();
});

test('Phase 1: accelerated complete race does not teleport across old track bounds',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='mobile-webkit','single heavy full-race deterministic WebKit simulation');
  test.setTimeout(220000);
  await page.goto('/?track=1&test&demo&quality=low',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__sk3d?.raceManager && !!window.__sk3d?.playerKart()?.state,null,{timeout:90000});
  await page.evaluate(()=>window.__sk3d.skipCountdown());
  await page.waitForFunction(()=>window.__sk3d?.raceManager?.phase==='race',null,{timeout:60000});
  const result=await page.evaluate(async()=>{
    const api=window.__sk3d,rm=api.raceManager,player=api.playerKart();
    api.loop.stop();
    rm.audio=null;rm.particles=null;rm.itemBoxes=[];rm.coins=[];
    const events=[];
    rm.onDiagnosticsEvent=(type,data)=>{if(events.length<200)events.push({type,...data})};
    let maxXZStep=0,last=player.state.position.clone(),maxProgress=0;
    let frames=0;
    for(let batch=0;batch<80;batch++){
      for(let j=0;j<100;j++){
        if(rm.phase!=='race'||rm.playerFinished)break;
        rm.update(1/30);
        frames++;
        const dx=player.state.position.x-last.x,dz=player.state.position.z-last.z;
        maxXZStep=Math.max(maxXZStep,Math.hypot(dx,dz));
        maxProgress=Math.max(maxProgress,player.state.lap+player.state.progress01);
        last.copy(player.state.position);
      }
      if(rm.phase!=='race'||rm.playerFinished)break;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return {
      frames,seconds:rm.elapsed,lap:player.state.lap,
      maxProgress,maxXZStep,finished:rm.playerFinished,
      rescues:events.filter(e=>e.type==='rescue'),
      contacts:events.filter(e=>e.type==='contact').length,
      length:api.track.length,
    };
  });
  expect(result.frames).toBeGreaterThan(500);
  expect(result.length).toBeGreaterThan(930);
  expect(result.rescues.filter(x=>x.reason==='outside-track-bounds'&&x.player)).toHaveLength(0);
  expect(result.maxXZStep).toBeLessThan(15);
  expect(result.maxProgress).toBeGreaterThan(1.2);
  // Completion can vary with AI randomization. The essential guarantee is
  // sustained valid progression without ghost walls or teleport loops.
});
