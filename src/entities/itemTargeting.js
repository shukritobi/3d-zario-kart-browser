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
