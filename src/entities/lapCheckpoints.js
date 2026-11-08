/**
 * Ordered checkpoints defend against false laps when the nearest-track
 * sample jumps across hairpins or the start seam. A complete lap must
 * cross 25%, 50%, 75% and then the start line, in that order.
 */
export function advanceLapCheckpoint(stage,lastProgress,nextProgress,aligned,speed) {
  if(!Number.isFinite(nextProgress))return {stage:stage||0,completed:false};
  let next=stage||0;
  if(next===0 && nextProgress>.20 && nextProgress<.40)next=1;
  else if(next===1 && nextProgress>.46 && nextProgress<.63)next=2;
  else if(next===2 && nextProgress>.70 && nextProgress<.87)next=3;
  const crosses = lastProgress>.86 && nextProgress<.14;
  if(crosses){
    const completed=next===3 && aligned && speed>5;
    return {stage:0,completed};
  }
  return {stage:next,completed:false};
}
