/** Non-runtime Zario asset-manifest contract check. Run: node tools/zario/check-zario-assets.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root,'public/models/zario/asset-manifest.json');
const m = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const pairs = [
 ['Turbo','Flare_Runner','turbo','flare-runner'],
 ['Comet','Starstream_GT','comet','starstream-gt'],
 ['Bolt','Snapback_R','bolt','snapback-r'],
 ['Daisy','Bloom_Buggy','daisy','bloom-buggy'],
 ['King','Royal_Rumbler','king','royal-rumbler'],
 ['Pip','Pocket_Rocket','pip','pocket-rocket']
];
assert.equal(m.schema_version,1);
assert.ok(Array.isArray(m.assets));
assert.equal(m.assets.length,pairs.length);
for(const k of ['length','width','height','wheel_radius','wheel_width','wheelbase']){
 assert.ok(Number.isFinite(m.chassis[k]) && m.chassis[k]>0,'Invalid chassis '+k);
}
let ready=0;
for(let i=0;i<pairs.length;i++){
 const [driver,kart,characterSlug,kartSlug]=pairs[i],a=m.assets[i];
 assert.equal(a.driver,driver); assert.equal(a.kart,kart);
 assert.equal(a.character_glb,'./characters/'+characterSlug+'.glb');
 assert.equal(a.kart_glb,'./karts/'+kartSlug+'.glb');
 assert.equal(typeof a.ready,'boolean');
 if(!a.ready) continue;
 ready++;
 for(const rel of [a.character_glb,a.kart_glb]){
  const file=path.resolve(path.dirname(manifestPath),rel);
  assert.ok(file.startsWith(path.dirname(manifestPath)+path.sep),'Unsafe path');
  assert.ok(fs.existsSync(file),driver+' ready=true but missing '+rel);
  const header=Buffer.alloc(12),fd=fs.openSync(file,'r');
  try{fs.readSync(fd,header,0,12,0)}finally{fs.closeSync(fd)}
  assert.equal(header.toString('utf8',0,4),'glTF');
  assert.equal(header.readUInt32LE(4),2);
  assert.equal(header.readUInt32LE(8),fs.statSync(file).size);
 }
}
console.log('Zario contract PASS: '+pairs.length+' racer pairs; '+ready+' marked ready.');
console.log('This check is not a substitute for visual, rig or animation QA.');
