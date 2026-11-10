import * as THREE from 'three';
/* Original longer circuits. The Catmull-Rom control points are deterministic:
 * broad sweepers, medium-radius hairpins, rolling hills and vista straights.
 * Circular envelope prevents self-intersections and hard 180-degree kinks.
 */
function makeCourse({count,radius,aspect,amplitude1,amplitude2,frequency1,frequency2,phase,height,offset=0}) {
  const result=[];
  for (let i=0;i<count;i++) {
    const theta=Math.PI-i*Math.PI*2/count;
    const r=radius+amplitude1*Math.sin(frequency1*theta+phase)+amplitude2*Math.sin(frequency2*theta-0.7);
    const y=1.3+height*(0.5+0.5*Math.sin(theta*2.0+phase));
    result.push(new THREE.Vector3(r*Math.cos(theta)+offset,y,r*aspect*Math.sin(theta)));
  }
  return result;
}
export const CANYON_PATH=makeCourse({
  count:30,radius:193,aspect:0.88,amplitude1:26,amplitude2:15,
  frequency1:3,frequency2:6,phase:0.4,height:5.8
});
export const SKY_PATH=makeCourse({
  count:32,radius:190,aspect:0.90,amplitude1:22,amplitude2:20,
  frequency1:4,frequency2:7,phase:1.3,height:7.2
});
export const VOLCANO_PATH=makeCourse({
  count:34,radius:198,aspect:0.86,amplitude1:28,amplitude2:16,
  frequency1:3,frequency2:5,phase:2.1,height:8.6
});
export const MANSION_PATH=makeCourse({
  count:32,radius:194,aspect:0.92,amplitude1:24,amplitude2:18,
  frequency1:2,frequency2:6,phase:0.85,height:6.4
});
export const EXTRA_TRACKS=Object.freeze({
  3:{id:3,name:'Sunset Canyon',icon:'🌅',desc:'Golden cliffs, flowing S-curves, jump gates and fast chicanes.',points:CANYON_PATH},
  4:{id:4,name:'Cloudtop Garden',icon:'🌈',desc:'Sky-blue hills, pastel arches, long bends and aerial launches.',points:SKY_PATH},
  5:{id:5,name:'Inferno Volcano',icon:'🌋',desc:'Erupting magma caldera, obsidian spires, glowing lava rivers and high-air stunt ramps.',points:VOLCANO_PATH},
  6:{id:6,name:'Haunted Mansion',icon:'👻',desc:'Twisted gothic manor grounds, eerie moonlit fog, floating ghosts and haunted courtyard jumps.',points:MANSION_PATH}
});
