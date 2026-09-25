// Loader visual — «Trails in Forms» by sabosugi: https://codepen.io/sabosugi/pen/emzdzmy
// Оригинальная реализация пена, встроенная в контейнер (вместо window) + setActive() для ускорения во время загрузки.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// follow:true — шар зафиксирован фронтально и наклоняется к курсору, пока мышь двигается; остановилась → плавно домой.
// axes:true — оси XYZ внутри шара (для отладки).
// thought:true — «мысль в мозгу»: участок сетки внутри шара с более частыми сигналами своего цвета, иногда вспыхивает.
export function mountLoader(container, { gui: withGui = true, params: over = {}, follow = false, axes = false, thought = false } = {}) {
  const W = () => container.clientWidth || 1, H = () => container.clientHeight || 1;

  // --- 1. Scene Setup ---
  const scene = new THREE.Scene();

  // Настройки — как на скрине
  const params = {
    shape: 'Sphere',
    backgroundColor: '#141414',
    lineColor: '#5c5c5c',
    dotColor: '#33fff1',
    useFog: true,
    fogDensity: 0.0275,
    useBloom: false,
    bloomThreshold: 0.385,
    bloomStrength: 1.5,
    bloomRadius: 0.4,
    onlyExternal: false,
    speed: 0.1,
    dotLength: 0.01,
    dotDensity: 1.809,
    thoughtColor: '#4cb3ff',   // цвет «мыслей» (--info из кита)
    thoughtLines: false,       // старый режим: «мысль» на отдельной густой сетке. Теперь — на тех же рёбрах, что и шум
    thoughtRep: 0.3,           // период «мыслей» относительно шума (меньше → мыслей больше)
  };
  Object.assign(params, over);   // цвета из UI-кита (index.html передаёт свои)

  scene.background = new THREE.Color(params.backgroundColor);
  scene.fog = new THREE.FogExp2(params.backgroundColor, params.fogDensity);

  const camera = new THREE.PerspectiveCamera(60, W() / H(), 0.1, 1000);
  camera.position.set(0, follow ? 0 : -1, 30);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W(), H());
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ReinhardToneMapping;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enableZoom = false;       // колесо мыши скроллит страницу, а не зумит сцену
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  let dragging = false;
  if (follow) {
    // крутить мышкой можно; автовращения нет; зум и пан выключены
    controls.autoRotate = false; controls.enablePan = false;
    controls.addEventListener('start', () => { dragging = true; });
    controls.addEventListener('end', () => { dragging = false; });
  }

  // --- 2. Post Processing (Bloom) ---
  const renderScene = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(W(), H()), 1.5, 0.4, 0.85);
  bloomPass.threshold = params.bloomThreshold;
  bloomPass.strength = params.bloomStrength;
  bloomPass.radius = params.bloomRadius;
  const composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);

  // --- 3. Math & Geometry Logic ---
  function isPointInside(v, shapeType) {
    const x = v.x, y = v.y, z = v.z;
    const r = 12;
    switch (shapeType) {
      case 'Cube': return Math.abs(x) < r && Math.abs(y) < r && Math.abs(z) < r;
      case 'Sphere': return (x*x + y*y + z*z) < (r*r);
      case 'Cut': {
        // шар с одной срезанной стороной: плоскость справа-спереди, отступ 6.5 от центра (r=12)
        if ((x*x + y*y + z*z) >= r*r) return false;
        return (x * 0.82 + y * 0.18 + z * 0.54) < 6.5;
      }
      case 'Pac': {
        // сфера лицом к зрителю: неглубокий «рот» спереди (клин ±17° в плоскости YZ, от z>4.5 — не до центра) и два «глаза»
        if ((x*x + y*y + z*z) >= r*r) return false;
        // лицом к зрителю (+Z): рот — горизонтальный клин спереди, глаза — две полости сверху
        if (z > 4.5 && Math.abs(Math.atan2(y, z)) < 0.3) return false;
        for (const sx of [-4, 4]) {
          const ex = x - sx, ey = y - 5.5, ez = z - 8;
          if (ex*ex + ey*ey + ez*ez < 2.6*2.6) return false;
        }
        return true;
      }
      case 'Pyramid': {
        if (y < -r || y > r) return false;
        const scale = (r - y) / (2 * r);
        const limit = r * 2 * scale;
        return Math.abs(x) < limit && Math.abs(z) < limit;
      }
      case 'Hexagon': {
        if (Math.abs(y) > r) return false;
        const q2 = Math.abs(x), r2 = Math.abs(z);
        return (q2 * 0.866 + r2 * 0.5) < r && q2 < r;
      }
      case 'Torus': {
        const tubeRadius = 4, mainRadius = 10;
        const distXZ = Math.sqrt(x*x + z*z) - mainRadius;
        return (distXZ*distXZ + y*y) < (tubeRadius*tubeRadius);
      }
      default: return Math.abs(x) < r && Math.abs(y) < r && Math.abs(z) < r;
    }
  }

  function isSurface(v, shapeType, step) {
    if (!isPointInside(v, shapeType)) return false;
    const dirs = [
      new THREE.Vector3(step,0,0), new THREE.Vector3(-step,0,0),
      new THREE.Vector3(0,step,0), new THREE.Vector3(0,-step,0),
      new THREE.Vector3(0,0,step), new THREE.Vector3(0,0,-step)
    ];
    for (const d of dirs) if (!isPointInside(v.clone().add(d), shapeType)) return true;
    return false;
  }

  // «мысль»: сфера внутри формы, где сетка гуще (отдельные блуждания) и сигналы помечены aHot=1
  // «мысль» в центре, размытая: плотность и «горячесть» плавно спадают от центра к R
  const HOT = { c: new THREE.Vector3(0, 0, 0), r: 9.5, segments: 1500 };
  const hotW = (p) => { const d = Math.max(0, p.distanceTo(HOT.c) / HOT.r - 0.3) / 0.7; return d >= 1 ? 0 : 1 - d*d*(3 - 2*d); };  // ядро ~30% R, дальше плавно к 0
  // «лицо» Pac: полоса вокруг рта и глаз — там сетка гуще и контур ярче, чтобы лицо читалось анфас
  const EYES = [[-4, 5.5, 8], [4, 5.5, 8]];
  const inFaceRim = (p) => {
    if (!isPointInside(p, 'Pac')) return false;
    const a = Math.abs(Math.atan2(p.y, p.z));
    if (p.z > 4.5 && a < 0.62) return true;                                  // губы
    for (const [ex, ey, ez] of EYES) if (p.distanceTo(new THREE.Vector3(ex, ey, ez)) < 4.4) return true;  // веки
    return false;
  };
  function createShapeGeometry(shapeType, onlyExternal) {
    const positions = [], attributes = [], hot = [], face = [];
    const step = 2, maxSegments = 6000;
    let currentPos = new THREE.Vector3(0, 0, 0);
    let currentDist = 0;

    const findStartPoint = () => {
      const p = new THREE.Vector3();
      for (let k = 0; k < 200; k++) {
        p.set((Math.random()-0.5)*26, (Math.random()-0.5)*26, (Math.random()-0.5)*26).round();
        p.x = Math.round(p.x/step)*step; p.y = Math.round(p.y/step)*step; p.z = Math.round(p.z/step)*step;
        if (onlyExternal ? isSurface(p, shapeType, step) : isPointInside(p, shapeType)) return p;
      }
      return new THREE.Vector3(0,0,0);
    };

    currentPos = findStartPoint();
    for (let i = 0; i < maxSegments; i++) {
      const dirs = [
        new THREE.Vector3(step,0,0), new THREE.Vector3(-step,0,0),
        new THREE.Vector3(0,step,0), new THREE.Vector3(0,-step,0),
        new THREE.Vector3(0,0,step), new THREE.Vector3(0,0,-step)
      ];
      const nextPos = currentPos.clone().add(dirs[Math.floor(Math.random() * 6)]);
      const isValid = onlyExternal ? isSurface(nextPos, shapeType, step) : isPointInside(nextPos, shapeType);
      if (isValid) {
        positions.push(currentPos.x, currentPos.y, currentPos.z, nextPos.x, nextPos.y, nextPos.z);
        attributes.push(currentDist, currentDist + step);
        hot.push(thought ? hotW(currentPos) : 0, thought ? hotW(nextPos) : 0); face.push(0, 0);   // вес «мысли» у общих рёбер
        currentDist += step;
        currentPos.copy(nextPos);
      } else {
        currentDist += 50.0;
        currentPos = findStartPoint();
      }
    }
    if (thought && params.thoughtLines) {
      const inHot = (p) => isPointInside(p, shapeType) && Math.random() < 0.15 + 0.85 * hotW(p);  // ближе к центру — гуще
      const startHot = () => {
        const p = new THREE.Vector3();
        for (let k = 0; k < 200; k++) {
          p.set(HOT.c.x + (Math.random()-0.5)*2*HOT.r, HOT.c.y + (Math.random()-0.5)*2*HOT.r, HOT.c.z + (Math.random()-0.5)*2*HOT.r);
          p.x = Math.round(p.x/step)*step; p.y = Math.round(p.y/step)*step; p.z = Math.round(p.z/step)*step;
          if (inHot(p)) return p;
        }
        return HOT.c.clone();
      };
      let hp = startHot();
      for (let i = 0; i < HOT.segments; i++) {
        const d = [[step,0,0],[-step,0,0],[0,step,0],[0,-step,0],[0,0,step],[0,0,-step]][Math.floor(Math.random()*6)];
        const np = hp.clone().add(new THREE.Vector3(...d));
        if (inHot(np)) {
          positions.push(hp.x, hp.y, hp.z, np.x, np.y, np.z);
          attributes.push(currentDist, currentDist + step);
          hot.push(hotW(hp), hotW(np)); face.push(0, 0);
          currentDist += step; hp.copy(np);
        } else { currentDist += 30.0; hp = startHot(); }
      }
    }
    if (shapeType === 'Pac') {
      const startFace = () => {
        const p = new THREE.Vector3();
        for (let k = 0; k < 400; k++) {
          p.set((Math.random()-0.5)*24, (Math.random()-0.5)*24, Math.random()*12);
          p.x = Math.round(p.x/step)*step; p.y = Math.round(p.y/step)*step; p.z = Math.round(p.z/step)*step;
          if (inFaceRim(p)) return p;
        }
        return null;
      };
      let fp = startFace();
      for (let i = 0; fp && i < 1400; i++) {
        const d = [[step,0,0],[-step,0,0],[0,step,0],[0,-step,0],[0,0,step],[0,0,-step]][Math.floor(Math.random()*6)];
        const np = fp.clone().add(new THREE.Vector3(...d));
        if (inFaceRim(np)) {
          positions.push(fp.x, fp.y, fp.z, np.x, np.y, np.z);
          attributes.push(currentDist, currentDist + step);
          hot.push(0, 0); face.push(1, 1);
          currentDist += step; fp.copy(np);
        } else { currentDist += 30.0; fp = startFace(); }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('lineDistance', new THREE.Float32BufferAttribute(attributes, 1));
    geometry.setAttribute('aHot', new THREE.Float32BufferAttribute(hot, 1));
    geometry.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 1));
    return geometry;
  }

  // --- 4. Shader ---
  const vertexShader = `
    attribute float lineDistance;
    attribute float aHot;
    attribute float aFace;
    varying float vDistance;
    varying float vHot;
    varying float vFace;
    void main() {
      vDistance = lineDistance;
      vHot = aHot;
      vFace = aFace;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const fragmentShader = `
    uniform vec3 colorLine;
    uniform vec3 colorDot;
    uniform vec3 uBgRaw;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uDotLength;
    uniform float uDotRepeat;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform bool uUseFog;
    uniform vec3 colorThought;
    uniform float uPulse;       // 0..1 — вспышка «мысли»
    uniform float uHotTime;     // своё время «мысли» (интегрируется в JS, чтобы импульсы не дёргали фазу)
    varying float vDistance;
    varying float vHot;
    varying float vFace;
    uniform float uThoughtRep;
    // бегущая волна вдоль ребра: голова на конце периода, хвост длиной uDotLength·период
    float wave(float d, float rep) {
      float f = mod(d, rep), L = rep * uDotLength;
      return f < rep - L ? 0.0 : smoothstep(rep - L, rep, f);
    }
    void main() {
      // две связные системы на ОДНИХ и тех же рёбрах:
      //   шум   — зелёные сигналы, свой период и общее время uTime
      //   мысли — голубые сигналы, короче период, своё время uHotTime (быстрее, реагирует на импульсы),
      //           видимость = вес vHot (1 в центре → 0 к краю)
      float sN = wave(vDistance - uTime * uSpeed * 10.0, uDotRepeat * 10.0);
      float sT = wave(vDistance + 7.3 - uHotTime * uSpeed * 10.0, uDotRepeat * 10.0 * uThoughtRep) * vHot;
      // additive-блендинг прибавляет фон: вычитаем его, чтобы голова сигнала на фоне была ровно своего цвета
      vec3 finalColor = mix(colorLine, max(colorDot - uBgRaw, 0.0), sN);
      finalColor = mix(finalColor, max(colorThought - uBgRaw, 0.0) * (1.0 + uPulse * 2.2), sT);   // мысль поверх шума, иногда ярче
      float finalAlpha = max(0.2, max(sN, sT));
      gl_FragColor = vec4(finalColor, finalAlpha);
      if (uUseFog) {
        float depth = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = exp2(-uFogDensity * uFogDensity * depth * depth * 1.442695);
        fogFactor = clamp(fogFactor, 0.0, 1.0);
        gl_FragColor.rgb = mix(uFogColor, gl_FragColor.rgb, fogFactor);
      }
    }`;

  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      colorLine: { value: new THREE.Color(params.lineColor) },
      // цвет сигнала передаём как есть (без sRGB→linear): шейдер не делает обратного преобразования,
      // иначе зелёный из кита на экране уезжает в «кислотный»
      colorDot: { value: new THREE.Color().setStyle(params.dotColor, THREE.LinearSRGBColorSpace) },
      uBgRaw: { value: new THREE.Color().setStyle(params.backgroundColor, THREE.LinearSRGBColorSpace) },
      colorThought: { value: new THREE.Color().setStyle(params.thoughtColor, THREE.LinearSRGBColorSpace) },
      uPulse: { value: 0 },
      uHotTime: { value: 0 },
      uThoughtRep: { value: params.thoughtRep },
      uTime: { value: 0 },
      uSpeed: { value: params.speed },
      uDotLength: { value: params.dotLength },
      uDotRepeat: { value: params.dotDensity },
      uFogColor: { value: new THREE.Color(params.backgroundColor) },
      uFogDensity: { value: params.fogDensity },
      uUseFog: { value: params.useFog },
    },
    transparent: true, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });

  let mesh = new THREE.LineSegments(createShapeGeometry(params.shape, params.onlyExternal), material);
  // rig — то, что наклоняется к курсору: шар + отладочные оси
  const rig = new THREE.Group();
  scene.add(rig);
  rig.add(mesh);
  if (axes) {
    const ax = new THREE.AxesHelper(16);            // X красная, Y зелёная, Z синяя
    ax.material.depthTest = false; ax.material.fog = false; ax.renderOrder = 10;
    rig.add(ax);
  }

  // --- 5. GUI (свёрнута, в углу визуала) ---
  const gui = new GUI({ title: 'System Core', container });
  gui.domElement.classList.add('viz-gui');
  const rebuildGeo = () => {
    rig.remove(mesh); mesh.geometry.dispose();
    mesh = new THREE.LineSegments(createShapeGeometry(params.shape, params.onlyExternal), material);
    rig.add(mesh);
  };
  const fGeo = gui.addFolder('Geometry');
  fGeo.add(params, 'shape', ['Cube', 'Sphere', 'Cut', 'Pac', 'Pyramid', 'Hexagon', 'Torus']).name('Form Factor').onChange(rebuildGeo);
  fGeo.add(params, 'onlyExternal').name('Only External').onChange(rebuildGeo);
  const fColors = gui.addFolder('Colors');
  fColors.addColor(params, 'backgroundColor').name('Background').onChange(val => {
    scene.background.set(val); scene.fog.color.set(val); material.uniforms.uBgRaw.value.setStyle(val, THREE.LinearSRGBColorSpace); material.uniforms.uFogColor.value.set(val);
  });
  fColors.addColor(params, 'lineColor').name('Wire Color').onChange(val => material.uniforms.colorLine.value.set(val));
  fColors.addColor(params, 'dotColor').name('Signal Color').onChange(val => material.uniforms.colorDot.value.setStyle(val, THREE.LinearSRGBColorSpace));
  const fSignal = gui.addFolder('Signal Props');
  fSignal.add(params, 'speed', 0.1, 2.0).name('Flow Speed').onChange(val => material.uniforms.uSpeed.value = val);
  fSignal.add(params, 'dotLength', 0.01, 0.5).name('Signal Tail').onChange(val => material.uniforms.uDotLength.value = val);
  fSignal.add(params, 'dotDensity', 1.0, 10.0).name('Density (1/Freq)').onChange(val => material.uniforms.uDotRepeat.value = val);
  const fRender = gui.addFolder('Rendering');
  fRender.add(params, 'useFog').name('Fog Enabled').onChange(val => { material.uniforms.uUseFog.value = val; });
  fRender.add(params, 'fogDensity', 0.0, 0.1).name('Fog Density').onChange(val => { scene.fog.density = val; material.uniforms.uFogDensity.value = val; });
  fRender.add(params, 'useBloom').name('Bloom Effect');
  fRender.add(params, 'bloomThreshold', 0.0, 1.0).name('Bloom Thresh').onChange(val => bloomPass.threshold = val);
  fRender.add(params, 'bloomStrength', 0.0, 3.0).name('Bloom Strength').onChange(val => bloomPass.strength = val);
  fRender.add(params, 'bloomRadius', 0.0, 1.0).name('Bloom Radius').onChange(val => bloomPass.radius = val);
  gui.close();
  if (!withGui) gui.domElement.style.display = 'none';

  // --- 6. Animation ---
  // uTime накапливаем сами: смена скорости (boost во время загрузки) идёт плавно, без скачка сигналов
  // --- 6a. Слежение за курсором ---
  // target — наклон к курсору, пока мышь двигается; через IDLE мс без движения target = 0.
  // Изинг: экспоненциальное сглаживание, скорость зависит от скорости курсора (быстрее мышь → меньше изинга).
  const MAX_TILT = 0.38, IDLE = 180, THRESH = 6,  // THRESH — мёртвая зона: курсор должен сдвинуться ≥6px, чтобы шар отреагировал
        RATE_MIN = 1.6, RATE_MAX = 12, RATE_RETURN = 2.4;
  const aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  let lastMove = -1e9, lastX = 0, lastY = 0, lastT = 0, speed = 0;
  let ancX = null, ancY = null;
  if (follow) addEventListener('pointermove', (e) => {
    if (ancX === null) { ancX = e.clientX; ancY = e.clientY; lastX = ancX; lastY = ancY; lastT = performance.now(); return; }
    if (dragging) { ancX = e.clientX; ancY = e.clientY; return; }        // пока тянут — крутит OrbitControls, наклон не трогаем
    if (Math.hypot(e.clientX - ancX, e.clientY - ancY) < THRESH) return;   // дрожание руки не считаем
    ancX = e.clientX; ancY = e.clientY;
    const r = container.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const nx = Math.max(-1, Math.min(1, (e.clientX - cx) / (innerWidth / 2)));
    const ny = Math.max(-1, Math.min(1, (e.clientY - cy) / (innerHeight / 2)));
    aim.y = nx * MAX_TILT;          // курсор вправо → поворот вокруг Y к нему
    aim.x = ny * MAX_TILT;          // курсор вниз → передняя сторона наклоняется вниз
    const now = performance.now(), dtm = Math.max(1, now - lastT);
    const v = Math.hypot(e.clientX - lastX, e.clientY - lastY) / dtm;   // px/мс
    speed += (Math.min(v, 4) - speed) * 0.35;
    lastX = e.clientX; lastY = e.clientY; lastT = now; lastMove = now;
  }, { passive: true });
  const followStep = (dt) => {
    const moving = performance.now() - lastMove < IDLE;
    const tx = moving ? aim.x : 0, ty = moving ? aim.y : 0;
    if (!moving) speed *= Math.exp(-dt * 6);
    const rate = moving ? RATE_MIN + (RATE_MAX - RATE_MIN) * Math.min(1, speed / 3.5) : RATE_RETURN;
    const k = 1 - Math.exp(-dt * rate);
    cur.x += (tx - cur.x) * k; cur.y += (ty - cur.y) * k;
    rig.rotation.set(cur.x, cur.y, 0);
  };

  // «Мысль»: фон — спокойное размышление (медленное «дыхание» на 5–15%),
  // поверх — редкие импульсы трёх видов со случайной силой и формой:
  //   рябь 65%   — слабая (0.15–0.35), мягкий рост 0.4–0.9 с, долгий спад 2–4 с
  //   мысль 28%  — средняя (0.4–0.65), рост 0.15–0.35 с, спад 1–2 с; в 35% случаев тянет за собой «цепочку» из 1–2 откликов
  //   озарение 7% — сильная (0.9–1.1), рост 0.06 с, спад 0.5–0.9 с, иногда двойная
  // Паузы между импульсами — случайные, 2–11 с (чаще 3–6), так что преобладает тишина.
  const R = (a, b) => a + Math.random() * (b - a);
  const pulses = [];
  const addPulse = (amp, rise, decay, delay = 0) => pulses.push({ t0: clock.elapsedTime + delay, amp, rise, decay });
  const spawn = (kind) => {
    const k = kind || (() => { const r = Math.random(); return r < 0.65 ? 'ripple' : r < 0.93 ? 'thought' : 'insight'; })();
    if (k === 'ripple') addPulse(R(0.15, 0.35), R(0.4, 0.9), R(2, 4));
    else if (k === 'thought') {
      addPulse(R(0.4, 0.65), R(0.15, 0.35), R(1, 2));
      if (Math.random() < 0.35) { const n = 1 + (Math.random() < 0.4); for (let i = 1; i <= n; i++) addPulse(R(0.2, 0.4), R(0.15, 0.3), R(0.8, 1.5), i * R(0.35, 0.8)); }
    } else {
      addPulse(R(0.9, 1.1), 0.06, R(0.5, 0.9));
      if (Math.random() < 0.4) addPulse(R(0.5, 0.8), 0.05, R(0.4, 0.7), R(0.18, 0.3));
    }
  };
  const nextGap = () => Math.min(11, 2 + (-Math.log(1 - Math.random())) * 2.6);   // экспоненциальные паузы, среднее ~4.6 с
  let nextPulse = 0;
  const pulseLevel = (now) => {
    if (now > nextPulse) { if (nextPulse) spawn(); nextPulse = now + nextGap(); }
    const calm = 0.05 + 0.05 * (0.5 + 0.5 * Math.sin(now * 0.7)) + 0.04 * (0.5 + 0.5 * Math.sin(now * 0.23 + 1.3));
    let v = 0;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], a = now - p.t0;
      if (a < 0) continue;
      const e = a < p.rise ? Math.sin((a / p.rise) * Math.PI / 2) : Math.exp(-(a - p.rise) * (3 / p.decay));
      if (a > p.rise + p.decay * 3) { pulses.splice(i, 1); continue; }
      v += p.amp * e;
    }
    return Math.min(1.2, calm + v);
  };

  const clock = new THREE.Clock();
  let t = 0, boost = 1, boostTarget = 1, running = true;
  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    boost += (boostTarget - boost) * Math.min(1, dt * 3);
    t += dt * boost;
    material.uniforms.uTime.value = t;
    material.uniforms.uHotTime.value += dt * boost * (1.4 + material.uniforms.uPulse.value);
    if (thought) {
      material.uniforms.uPulse.value = pulseLevel(clock.elapsedTime);
    }
    if (follow) { followStep(dt); controls.update(); }
    else { controls.autoRotateSpeed = 0.5 * boost; controls.update(); }
    if (params.useBloom) composer.render(); else renderer.render(scene, camera);
  }

  const resize = () => {
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
    composer.setSize(W(), H());
  };
  new ResizeObserver(resize).observe(container);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false;
    else if (!running) { running = true; clock.getDelta(); animate(); }
  });
  animate();

  return {
    setActive(on) { boostTarget = on ? 3.5 : 1; },
    pulse(kind = 'thought') { spawn(kind); },   // импульс «мысли» по требованию: 'ripple' | 'thought' | 'insight'
    params,
  };
}
