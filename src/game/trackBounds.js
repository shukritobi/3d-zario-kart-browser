/**
 * Track-relative rescue envelope. The original 95 x 62m static bounds were
 * for a tiny circuit; all longer routes looked "out of bounds" and the game
 * teleported karts away every second, causing jerky movement and false laps.
 */
export function computeTrackBounds(path,padding=45,samples=240){
  if(!path||typeof path.getPointAt!=='function')return null;
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(let i=0;i<samples;i++){
    const p=path.getPointAt(i/samples);
    minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);
    minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);
  }
  return {minX:minX-padding,maxX:maxX+padding,
    minZ:minZ-padding,maxZ:maxZ+padding};
}
export function isOutsideTrackBounds(point,bounds){
  if(!point||!bounds)return false;
  return point.x<bounds.minX||point.x>bounds.maxX||
    point.z<bounds.minZ||point.z>bounds.maxZ;
}
export function sampleIndexAtProgress(progress01,sampleCount=384){
  const count=Math.max(1,sampleCount);
  const p=Math.max(0,Math.min(.999999,Number(progress01)||0));
  return Math.min(count-1,Math.max(0,Math.round(p*count)%count));
}
