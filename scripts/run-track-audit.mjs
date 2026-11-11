/**
 * Full-circuit Zario Kart flight recorder (Chromium + Playwright).
 * npm install --no-save @playwright/test
 * npx playwright install chromium
 * npm run audit:tracks
 * Artifacts: artifacts/track-audit/{SUMMARY.md,track-01..06/*.json,*.png}
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const OUTPUT = 'artifacts/track-audit';
const HOST = 'http://127.0.0.1:3457';
const MAX_FRAMES = Math.max(300, Number(process.env.ZARIO_AUDIT_MAX_FRAMES) || 9000);
const BATCH_FRAMES = 75;
const tracks = ['Meadow Circuit','Neon City','Sunset Canyon','Cloudtop Garden','Inferno Volcano','Haunted Mansion'];
const started = new Date().toISOString();
const run = { schema:'zario-all-track-audit-v1', startedAt:started, tracks:[], mobileScreens:[], errors:[] };
let server = null, browser = null;

async function waitServer() {
  for (let i = 0; i < 120; i++) {
    try { const res = await fetch(HOST); if (res.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Vite development server did not become ready');
}
async function saveJson(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function screenshot(page, dir, name, arr) {
  try {
    const file = join(dir,name+'.png');
    // Render immediately before capturing, even when the RAF game loop is paused.
    await page.evaluate(() => window.__sk3d?.qaStep?.(1/60, true));
    await page.screenshot({path:file, fullPage:false, animations:'disabled', timeout:20000});
    arr.push(file);
  } catch (error) {
    arr.push('Screenshot failed: '+String(error?.message || error));
  }
}

async function auditTrack(id) {
  const dir = join(OUTPUT,'track-'+String(id).padStart(2,'0'));
  await mkdir(dir,{recursive:true});
  const log = {trackId:id,trackName:tracks[id-1],startedAt:new Date().toISOString(),
    status:'starting',browserErrors:[],consoleErrors:[],networkFailures:[],screenshots:[],
    milestones:[], frames:0};
  const page = await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
  page.on('pageerror', error => log.browserErrors.push(String(error.stack || error).slice(0,1500)));
  page.on('console', msg => {
    if (msg.type()==='error') log.consoleErrors.push(msg.text().slice(0,600));
  });
  page.on('requestfailed', req => {
    if (log.networkFailures.length < 60) log.networkFailures.push({
      url:req.url().slice(0,220), reason:req.failure()?.errorText || 'failed'
    });
  });
  try {
    await page.goto(HOST+'/?track='+id+'&demo=1&test=1&audit=1&quality=low',{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForFunction(
      () => ['countdown','race'].includes(window.__sk3d?.getState?.()) && !!window.__sk3d?.playerKart?.(),
      null,{timeout:100000}
    );
    await page.evaluate(() => window.__sk3d?.skipCountdown?.());
    await page.waitForFunction(() => window.__sk3d?.getState?.()==='race',null,{timeout:30000});
    await page.evaluate(() => window.__sk3d.loop.stop());
    log.status='racing';
    await screenshot(page,dir,'start',log.screenshots);
    const milestones = new Set();
    let latest = null;
    for (let frames=0;frames<MAX_FRAMES;frames+=BATCH_FRAMES) {
      latest = await page.evaluate(count => {
        let result;
        for (let i=0;i<count;i++) {
          result=window.__sk3d.qaStep(1/30,false);
          if(result.finished || result.state!=='race')break;
        }
        window.__sk3d.qaStep(1/60,true);
        return result;
      },Math.min(BATCH_FRAMES,MAX_FRAMES-frames));
      log.frames=frames+BATCH_FRAMES;
      if (!latest) throw new Error('Audit physics API did not return state');
      for (const threshold of [1,2]) {
        if (latest.lap>=threshold && !milestones.has(threshold)) {
          milestones.add(threshold);
          log.milestones.push({lap:threshold,seconds:+latest.seconds.toFixed(2),
            progress:latest.progress,position:latest.position});
          await screenshot(page,dir,'lap-'+(threshold+1),log.screenshots);
        }
      }
      if(latest.finished || latest.state==='finished') {
        log.status='completed';
        break;
      }
    }
    if(log.status!=='completed') log.status='frame-limit';
    await screenshot(page,dir,'finish-or-last-frame',log.screenshots);
    log.finalState=latest;
    log.diagnostics=await page.evaluate(() => window.__zarioDiagnostics.status());
    log.bridge=await page.evaluate(() => window.__zarioBridgeReport?.());
    log.completedAt=new Date().toISOString();
  } catch (error) {
    log.status='error';
    log.browserErrors.push('Audit aborted: '+String(error.stack || error));
    try {await page.screenshot({path:join(dir,'failure.png'),timeout:10000});}catch{}
  } finally {
    await saveJson(join(dir,'complete-log.json'),log);
    const stripped={...log};
    delete stripped.diagnostics;
    delete stripped.bridge;
    run.tracks.push(stripped);
    await page.close().catch(()=>{});
  }
  console.log('Track '+id+' '+log.trackName+': '+log.status+
    ', '+log.frames+' physics steps, '+(log.diagnostics?.counts?.wall || 0)+' wall hits');
}

async function mobileMenuScreens() {
  for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
    const label=viewport.width>viewport.height?'landscape':'portrait';
    const page=await browser.newPage({viewport,deviceScaleFactor:1,isMobile:true,hasTouch:true});
    try {
      await page.goto(HOST+'/?track=1&quality=low&test=1',{waitUntil:'domcontentloaded',timeout:45000});
      await page.waitForFunction(()=>!!window.__sk3d && !!document.querySelector('.sk3d-racers-btn'),null,{timeout:90000});
      for(const [mode,selector] of [['racers','.sk3d-racers-btn'],['tracks','.sk3d-tracks-btn']]) {
        if(mode==='tracks') await page.evaluate(()=>window.__sk3d.gotoMenu());
        await page.locator(selector).evaluate(el=>el.click());
        await page.waitForTimeout(300);
        const path=join(OUTPUT,'mobile-'+label+'-'+mode+'.png');
        await page.screenshot({path,animations:'disabled',timeout:15000});
        run.mobileScreens.push(path);
        await page.evaluate(()=>{
          document.querySelectorAll('.sk3d-back-btn').forEach(el=>el.click());
        });
      }
    } catch(error) {
      run.errors.push('mobile '+label+': '+String(error.stack || error));
    } finally {await page.close().catch(()=>{});}
  }
}

function summaryMarkdown() {
  const lines=['# Zario Kart all-track automated audit','',
    'Run started: '+started,'Viewport: 1280×720; Chromium headless; test-mode graphics',
    'Full DEMO AI-driven physics simulated via deterministic 30 Hz steps.',
    'Screenshots are generated at race start, lap milestones and finish.','',
    '| Track | Result | Simulated time | Wall hits | Contacts | Ramps | Tricks | Slow frames |',
    '|---|---|---:|---:|---:|---:|---:|---:|'];
  for (const t of run.tracks) {
    const d=t.finalState||{},c=t.diagnostics?.counts||{};
    lines.push('| '+t.trackId+' '+t.trackName+' | '+t.status+' | '+
      (d.seconds==null?'?':d.seconds.toFixed(1)+'s')+' | '+(c.wall??'?')+' | '+
      (c.contact??'?')+' | '+(c.rampLaunch??'?')+' | '+(c.trick??'?')+' | '+(c.slowFrame??'?')+' |');
  }
  lines.push('','## Complete logs and screenshots','Each track-XX/complete-log.json contains ALL retained flight-recorder samples, events, browser JS errors and bridge status.','Screenshots are in the corresponding folder. Mobile layout images are in the root.','','## Warnings');
  let n=0;
  for (const t of run.tracks) {
    if(t.status!=='completed'||t.browserErrors.length||t.consoleErrors.length) {
      n++;lines.push('- Track '+t.trackId+': '+t.status+', page errors '+t.browserErrors.length+', console errors '+t.consoleErrors.length);
    }
  }
  if (run.errors.length) for(const err of run.errors) {n++;lines.push('- '+err.slice(0,180));}
  if(!n) lines.push('No script errors or incomplete races observed. This is a synthetic browser audit, not physical-device validation.');
  return lines.join('\n')+'\n';
}

try {
  await mkdir(OUTPUT,{recursive:true});
  server = spawn('npm',['run','dev','--','--host','127.0.0.1'],{stdio:'ignore',shell:process.platform==='win32'});
  await waitServer();
  browser = await chromium.launch({headless:true,args:[
    '--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--no-sandbox',
  ]});
  for(let i=1;i<=6;i++) await auditTrack(i);
  await mobileMenuScreens();
} catch(error) {
  run.errors.push(String(error.stack || error));
  console.error('[Zario audit]',error);
} finally {
  run.finishedAt=new Date().toISOString();
  await saveJson(join(OUTPUT,'all-track-summary.json'),run);
  const summary=summaryMarkdown();
  await writeFile(join(OUTPUT,'SUMMARY.md'),summary,'utf8');
  await writeFile(join(OUTPUT,'COPY-PASTE-SUMMARY.txt'),summary,'utf8');
  console.log(summary);
  await browser?.close().catch(()=>{});
  server?.kill('SIGTERM');
}
if(run.errors.length || run.tracks.length!==6 || run.tracks.some(t=>t.status==='error'))
  process.exitCode=1;
