export function nearestCenterlineIndex(points,x,z,hint=-1,windowSize=12){
  if(!points?.length)return {index:0,distanceSquared:Infinity};
  const n=points.length,full=hint<0||hint>=n;
  let best=Infinity,index=0;
  for(let step=0;step<(full?n:2*windowSize+1);step++){
    const i=full?step:(hint+step-windowSize+n*10)%n;
    const dx=points[i].x-x,dz=points[i].z-z;
    const d=dx*dx+dz*dz;
    if(d<best){best=d;index=i}
  }
  return !full&&best>225?nearestCenterlineIndex(points,x,z,-1,windowSize):{index,distanceSquared:best};
}

/** Squared distance from a point to a moving segment, prevents projectile tunneling. */
export function pointSegmentDistanceSquared(px,pz,ax,az,bx,bz){
  const dx=bx-ax,dz=bz-az,den=dx*dx+dz*dz;
  const t=den>1e-8?Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/den)):0;
  const qx=px-(ax+t*dx),qz=pz-(az+t*dz);
  return qx*qx+qz*qz;
}
