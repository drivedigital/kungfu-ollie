import * as THREE from "three";

/** Merge geometries (converted to non-indexed) that share position/normal/uv attributes. */
export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array as Float32Array, o * 2);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Ellipsoid with its center and radii baked into the vertex data (so object space == parent-joint space). */
export function ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, ws = 24, hs = 16) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  g.translate(cx, cy, cz);
  return g;
}

/** Capsule hanging downward from the origin. */
export function capsuleDown(r: number, len: number, capSeg = 4, radial = 12) {
  const g = new THREE.CapsuleGeometry(r, len, capSeg, radial);
  g.translate(0, -len / 2, 0);
  return g;
}
