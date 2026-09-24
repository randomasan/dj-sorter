// Loader visual: «сигналы бегут по проводам внутри формы».
// Своя реализация по мотивам https://codepen.io/sabosugi/pen/emzdzmy (Trails in Forms – Three.js)
import * as THREE from 'three';

export const LOADER_DEFAULTS = {
  form: 'sphere',        // Form Factor
  onlyExternal: false,   // Only External (только по поверхности)
  background: 0x141414,
  wire: 0x5c5c5c,
  signal: 0x33fff1,
  flowSpeed: 0.1,
  signalTail: 0.01,
  density: 1.809,        // Density (1/Freq)
  fog: true,
  fogDensity: 0.0275,
  radius: 9,
  walks: 120,
  steps: 70,
};

export function mountLoader(canvas, opts = {}) {
  const P = { ...LOADER_DEFAULTS, ...opts };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(P.background, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 4, 30);
  camera.lookAt(0, 0, 0);

  // ---- геометрия: случайные блуждания по решётке внутри сферы ----
  const R = P.radius, R2 = R * R;
  const inside = (x, y, z) => x * x + y * y + z * z <= R2;
  const onSurface = (x, y, z) => inside(x, y, z) &&
    [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([a,b,c]) => !inside(x+a, y+b, z+c));
  const ok = P.onlyExternal ? onSurface : inside;
  const DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const rnd = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

  const pos = [], prog = [], off = [];
  for (let w = 0; w < P.walks; w++) {
    let p;
    for (let tries = 0; tries < 200; tries++) { p = [rnd(-R, R), rnd(-R, R), rnd(-R, R)]; if (ok(...p)) break; }
    if (!ok(...p)) continue;
    let dist = 0, last = -1; const o = Math.random() * 100;
    for (let s = 0; s < P.steps; s++) {
      const cand = DIRS.map((d, i) => [d, i]).filter(([d, i]) => (i ^ 1) !== last && ok(p[0]+d[0], p[1]+d[1], p[2]+d[2]));
      if (!cand.length) break;
      // инерция: чаще продолжаем в том же направлении — линии получаются «проводами», а не шумом
      const same = cand.find(([, i]) => i === last);
      const [d, i] = same && Math.random() < 0.55 ? same : cand[Math.floor(Math.random() * cand.length)];
      const q = [p[0]+d[0], p[1]+d[1], p[2]+d[2]];
      pos.push(...p, ...q); prog.push(dist, dist + 1); off.push(o, o);
      dist += 1; p = q; last = i;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aProg', new THREE.Float32BufferAttribute(prog, 1));
  geo.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 1));

  const uniforms = {
    uTime: { value: 0 },
    uSpeed: { value: P.flowSpeed },
    uBoost: { value: 1 },
    uTail: { value: P.signalTail },
    uPeriod: { value: P.density * 8 },
    uWire: { value: new THREE.Color(P.wire) },
    uSignal: { value: new THREE.Color(P.signal) },
    uBg: { value: new THREE.Color(P.background) },
    uFog: { value: P.fog ? P.fogDensity : 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aProg; attribute float aOff;
      varying float vProg; varying float vOff; varying float vDepth;
      void main(){
        vProg = aProg; vOff = aOff;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime, uSpeed, uBoost, uTail, uPeriod, uFog;
      uniform vec3 uWire, uSignal, uBg;
      varying float vProg; varying float vOff; varying float vDepth;
      void main(){
        // голова сигнала движется вдоль пути; хвост тянется назад
        float head = uTime * uSpeed * 60.0 * uBoost + vOff;
        float d = mod(head - vProg, uPeriod);          // расстояние от головы назад по пути
        float tail = max(0.35, uTail * 90.0);
        float s = 1.0 - smoothstep(0.0, tail, d);
        s *= step(0.0, d);
        vec3 col = uWire * 0.55 + uSignal * s * 1.6;
        float fog = uFog > 0.0 ? 1.0 - exp(-pow(vDepth * uFog, 2.0)) : 0.0;
        col = mix(col, uBg, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  const group = new THREE.Group(); group.add(lines); scene.add(group);

  // ---- размер / цикл ----
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // сфера целиком в кадре при любой ширине
    // вписываем сферу по высоте (и по ширине на узких экранах) с небольшим запасом
    const fitH = (R * 1.12) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.z = Math.max(fitH, fitH / Math.min(camera.aspect, 1));
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas); resize();

  let t = 0, last = performance.now(), running = true, boostTarget = 1;
  const frame = (now) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    uniforms.uBoost.value += (boostTarget - uniforms.uBoost.value) * Math.min(1, dt * 3);
    t += dt; uniforms.uTime.value = t;
    group.rotation.y += dt * 0.08 * uniforms.uBoost.value;
    group.rotation.x = Math.sin(t * 0.15) * 0.12;
    renderer.render(scene, camera);
    if (!reduce) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false;
    else if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
  });

  return {
    // активная загрузка → сигналы бегут быстрее
    setActive(on) { boostTarget = on ? 3.5 : 1; },
    setSignal(hex) { uniforms.uSignal.value.set(hex); },
  };
}
