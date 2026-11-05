// The 3D preview on the converter page: a converted model in a box on the page, turned with the mouse
// or a finger. It is a small three.js scene of its own, because the editor's view3d.ts needs the
// editor's state. It draws when the view changes or the box is resized, never in a loop, so an idle
// page costs nothing.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** A model to preview: `positions` in millimetres, nine floats per triangle; `colors` one rgb per vertex, 0 to 1. */
export interface PreviewMesh {
  positions: Float32Array;
  colors: Float32Array;
  triangles: number;
  /** true when the model was cut short to fit the preview's triangle limit */
  capped: boolean;
}

/** Shows `mesh` in `host` as a model to turn with the mouse or a finger, z up, framed to fit; throws "3D preview needs WebGL" without WebGL. */
export function showPreview3d(host: HTMLElement, mesh: PreviewMesh): { dispose(): void } {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    throw new Error("3D preview needs WebGL");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  host.append(canvas);

  // the page's panel colour, so the preview sits on the page like the rest of it
  const background = getComputedStyle(host).getPropertyValue("--surface-2").trim() || "#262626";
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  // double-sided, because a converted model's faces often have no inside to hide behind
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  scene.add(new THREE.Mesh(geometry, material));

  // a model of one point (or none) still gets a frame to fit
  const sphere = geometry.boundingSphere ?? new THREE.Sphere();
  const center = sphere.center.clone();
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 2.2);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.copy(center).add(new THREE.Vector3(1, -1.5, 2).multiplyScalar(radius));
  sun.target.position.copy(center);
  scene.add(hemisphere, sun, sun.target);

  // z is up, as in the editor; the camera starts from the front-right, a little above the ground
  const camera = new THREE.PerspectiveCamera(40, 1, radius * 0.01, radius * 50);
  camera.up.set(0, 0, 1);
  // far enough that the model's bounding sphere fits the 40° view: radius / sin(20°)
  camera.position.copy(center).add(new THREE.Vector3(1, -1.2, 0.9).normalize().multiplyScalar(radius / Math.sin(THREE.MathUtils.degToRad(20))));
  camera.lookAt(center);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.update();

  // no loop: the scene is drawn when the view moves or the box changes size
  const draw = (): void => renderer.render(scene, camera);
  controls.addEventListener("change", draw);

  const resize = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  return {
    dispose(): void {
      observer.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      // a page that previews many files would otherwise hold a WebGL context for each until garbage collection
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
