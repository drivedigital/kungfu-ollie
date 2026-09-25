import * as THREE from "three";
import { FX, Motes } from "../FX";
import { Arena, disposeGroup, makeSun } from "./common";

/** A first playable Kyoto floor with inexpensive layered spectator art. */
export function buildKyoto(): Arena {
  const group = new THREE.Group();
  const loader = new THREE.TextureLoader();
  const vista = loader.load("/arenas/kyoto-coliseum-gameplay-view.png");
  vista.colorSpace = THREE.SRGBColorSpace;
  const panorama = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 22),
    new THREE.MeshBasicMaterial({ map: vista, fog: false, side: THREE.DoubleSide, depthWrite: false }),
  );
  panorama.position.set(0, 6.5, -26);
  group.add(panorama);

  // Real level collision floor; all combat remains on the game's Y=0, Z=0 plane.
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x8f6d66, roughness: 0.9, metalness: 0.02 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 22), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  const medallion = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 64),
    new THREE.MeshStandardMaterial({ color: 0xa98275, roughness: 0.86, metalness: 0.04 }),
  );
  medallion.rotation.x = -Math.PI / 2;
  medallion.position.y = 0.008;
  medallion.receiveShadow = true;
  group.add(medallion);
  for (const radius of [1.2, 2.3, 3.3]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.025, radius + 0.025, 64),
      new THREE.MeshStandardMaterial({ color: 0x694d49, roughness: 0.9, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.014;
    group.add(ring);
  }
  const stoneLine = new THREE.MeshStandardMaterial({ color: 0x604d4b, roughness: 1 });
  for (let x = -16; x <= 16; x += 2) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.004, 22), stoneLine);
    line.position.set(x, 0.012, 0);
    group.add(line);
  }
  for (let z = -11; z <= 11; z += 2) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(34, 0.004, 0.025), stoneLine);
    line.position.set(0, 0.012, z);
    group.add(line);
  }

  const audience = loader.load("/arenas/kyoto-audience-concept-panel.png");
  audience.colorSpace = THREE.SRGBColorSpace;
  const audienceMat = new THREE.MeshBasicMaterial({ map: audience, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  for (const x of [-12.5, 12.5]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(10, 5.6), audienceMat);
    panel.position.set(x, 3.2, -10);
    panel.rotation.y = x < 0 ? 0.25 : -0.25;
    group.add(panel);
  }

  const sun = makeSun(0xffc79b, 2.7, new THREE.Vector3(7, 13, -8), 1024);
  group.add(sun, sun.target);
  group.add(new THREE.HemisphereLight(0xfbe3f1, 0x684351, 1.7));
  const petals = new Motes({
    count: 110,
    box: { x: 0, y: 4, z: 0, w: 31, h: 8, d: 17 },
    color: 0xffa8cc, size: 0.16, opacity: 0.8,
    velocity: new THREE.Vector3(0.28, -0.35, 0.05), jitter: 0.7,
  });
  group.add(petals.points);
  return {
    group, sun, exposure: 1.08,
    bloom: { strength: 0.4, threshold: 0.9, radius: 0.55 },
    fog: new THREE.Fog(0xdcbac2, 38, 115),
    background: new THREE.Color(0xdcbac2),
    dustColor: 0xf5a6c5,
    update(dt: number, _time: number, _fx: FX) { petals.update(dt); },
    dispose() { disposeGroup(group); vista.dispose(); audience.dispose(); },
  };
}
