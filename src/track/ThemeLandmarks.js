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

  // Distinct themed roadside rhythms: sculpted sandstone spires in the
  // canyon, rounded floating clouds and pastel puffs in the sky garden.
  // InstancedMesh keeps these 60+ large landmarks to just two draw calls.
  const scenicCount=34;
  const mainGeo=themeId===3
    ? new THREE.ConeGeometry(1.8,9.5,7)
    : new THREE.SphereGeometry(2.8,12,8);
  const accentGeo=themeId===3
    ? new THREE.ConeGeometry(1.0,4.0,6)
    : new THREE.SphereGeometry(1.7,10,8);
  const mainMat=new THREE.MeshLambertMaterial({color:themeId===3?0xc46f55:0xedf7ff,flatShading:true});
  const accentMat=new THREE.MeshLambertMaterial({color:themeId===3?0xf1ae79:0xffbee2,flatShading:true});
  const large=new THREE.InstancedMesh(mainGeo,mainMat,scenicCount);
  const small=new THREE.InstancedMesh(accentGeo,accentMat,scenicCount);
  large.castShadow=false;
  small.castShadow=false;
  const dummy=new THREE.Object3D(),point=new THREE.Vector3(),tangent=new THREE.Vector3();
  for(let i=0;i<scenicCount;i++){
    const t=(i+0.45)/scenicCount;
    path.getPointAt(t,point);
    path.getTangentAt(t,tangent);
    const side=i%2===0?1:-1;
    const lateral=15+(i%4)*5;
    const px=point.x+side*tangent.z*lateral;
    const pz=point.z-side*tangent.x*lateral;
    const scale=0.72+(i%7)*0.15;
    dummy.position.set(px,point.y+(themeId===3?4.75*scale:9+(i%4)*2),pz);
    dummy.scale.set(scale,scale,scale);
    dummy.rotation.set(0,(i*1.92)%6.28,0.09*Math.sin(i));
    dummy.updateMatrix();
    large.setMatrixAt(i,dummy.matrix);
    dummy.position.set(px+2.4,point.y+(themeId===3?2.0*scale:11+(i%5)*1.4),pz+1.2);
    dummy.scale.set(scale*0.82,scale*0.82,scale*0.82);
    dummy.updateMatrix();
    small.setMatrixAt(i,dummy.matrix);
  }
  large.instanceMatrix.needsUpdate=true;
  small.instanceMatrix.needsUpdate=true;
  group.add(large,small);
  return group;
}
