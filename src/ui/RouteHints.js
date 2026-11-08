/**
 * Road-relative turn preview. Distances are metres, not a fractional lap.
 * For a rear chase camera facing +Z, screen-right is world -X, so +X is LEFT.
 */
export function computeUpcomingTurn(path, progress01, length, heading, speed) {
  if (!path || !Number.isFinite(progress01) || !(length>0) || !(speed>5)) return null;
  const mod=t=>(t%1+1)%1;
  const t=mod(progress01);
  const a=path.getTangentAt(mod(t+5/length));
  const b=path.getTangentAt(mod(t+28/length));
  const c=path.getTangentAt(mod(t+48/length));
  const dot=(u,v)=>Math.max(-1,Math.min(1,u.x*v.x+u.z*v.z));
  const angle=(u,v)=>Math.atan2(u.x*v.z-u.z*v.x,dot(u,v));
  const early=angle(a,b),later=angle(b,c);
  const selected=Math.abs(early)>=0.19 ? early : later;
  if(Math.abs(selected)<0.27) return null;
  const fwd={x:Math.sin(heading||0),z:Math.cos(heading||0)};
  if(dot(a,fwd)<0.18)return null;
  return {direction:selected<0?'LEFT':'RIGHT',
    turnDegrees:selected*180/Math.PI,
    distance:Math.abs(early)>=0.19?16:35};
}
