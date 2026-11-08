import * as THREE from 'three';
/** Low-cost original course landmarks: readable, oversized colored arches
 * and checker totems signal a new zone every 20-25% of the lap. Geometry
 * shares materials; no collision surfaces and no huge textures.
 */
export function buildThemeLandmarks(path,themeId) {
  const group=new THREE.Group();
  group.name='zario-track-landmarks';
  const colors=themeId===3 ? [0xf98e57,0xffdf85,0xc95376] : [0x78bffb,0xff8fc7,0xaf98f0];
  const ringGeo=new THREE.TorusGeometry(5.8,0.20,8,30,Math.PI);
  const poleGeo=new THREE.CylinderGeometry(0.23,0.29,1.5,8);
  const capGeo=new THREE.ConeGeometry(0.65,1.1,8);
  const signGeo=new THREE.BoxGeometry(2.3,0.74,0.18);
  const shared=colors.map(color=>new THREE.MeshBasicMaterial({color}));
  for(const [index,t] of [0.09,0.31,0.57,0.82].entries()){
    const p=path.getPointAt(t),dir=path.getTangentAt(t);
    const yaw=Math.atan2(dir.x,dir.z);
    const pivot=new THREE.Group();
    pivot.position.set(p.x,p.y+0.26,p.z);
    pivot.rotation.y=yaw;
    const arch=new THREE.Mesh(ringGeo,shared[index%3]);
    arch.position.y=1.35;
    pivot.add(arch);
    for(const sign of [-1,1]) {
      const post=new THREE.Mesh(poleGeo,shared[(index+1)%3]);
      post.position.set(sign*5.8,0.72,0);
      pivot.add(post);
      const cap=new THREE.Mesh(capGeo,shared[(index+2)%3]);
      cap.position.set(sign*5.8,1.93,0);
      pivot.add(cap);
    }
    const banner=new THREE.Mesh(signGeo,shared[(index+2)%3]);
    banner.position.set(0,6.65,-0.04);
    pivot.add(banner);
    group.add(pivot);
  }
  return group;
}
