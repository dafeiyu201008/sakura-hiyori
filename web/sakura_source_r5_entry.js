
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
    import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

    const canvas = document.querySelector('#scene');
    const loading = document.querySelector('#loading');
    const loadingBar = document.querySelector('#loading-bar');
    const loadingState = document.querySelector('#loading-state');
    const errorPanel = document.querySelector('#error');
    const diagnosticsPanel = document.querySelector('#diagnostics');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    function decodeInlineBase64(text) {
      const binary = atob(text);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return bytes.buffer;
    }

    document.body.classList.toggle('debug', new URLSearchParams(location.search).has('debug'));

    let toastTimer = 0;
    function showToast(message) {
      const toast = document.querySelector('#scene-toast');
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
    }

    function showError(error) {
      console.error(error);
      loading.classList.add('done');
      errorPanel.style.display = 'grid';
      document.querySelector('#error-copy').textContent = `当前浏览器未能打开三维场景，正在显示静帧。${error?.message ? ' ' + error.message : ''}`;
    }

    async function start() {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      const mobile = matchMedia('(max-width: 767px)').matches;
      renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.35 : 2.0));
      renderer.setSize(innerWidth, innerHeight, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xdde2dd);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const environment = new RoomEnvironment();
      const environmentTarget = pmrem.fromScene(environment, 0.04);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 0.46;
      environment.dispose();
      pmrem.dispose();

      const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.035, 180);
      const homePosition = new THREE.Vector3(19.8, 19.7, 26.5);
      const homeTarget = new THREE.Vector3(0, 2.25, -0.25);
      const homeOffset = homePosition.clone().sub(homeTarget);
      function framedHomePosition() {
        const aspect = innerWidth / innerHeight;
        const fitScale = aspect < 1 ? Math.min(1.72, 0.98 / aspect) : 1;
        return homeTarget.clone().add(homeOffset.clone().multiplyScalar(fitScale));
      }
      camera.position.copy(framedHomePosition());

      const controls = new OrbitControls(camera, canvas);
      controls.target.copy(homeTarget);
      controls.enableDamping = !reducedMotion;
      controls.dampingFactor = 0.065;
      controls.enablePan = false;
      controls.minDistance = 1.25;
      controls.maxDistance = 75;
      controls.minPolarAngle = THREE.MathUtils.degToRad(18);
      controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
      controls.rotateSpeed = 0.62;
      controls.zoomSpeed = 1.12;
      controls.update();

      const hemisphere = new THREE.HemisphereLight(0xdce8ef, 0x6d715c, 0.95);
      scene.add(hemisphere);
      const key = new THREE.DirectionalLight(0xffe2bc, 2.2);
      key.position.set(-8, 15, 10);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -15;
      key.shadow.camera.right = 15;
      key.shadow.camera.top = 16;
      key.shadow.camera.bottom = -14;
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 55;
      key.shadow.bias = -0.00015;
      key.shadow.normalBias = 0.025;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xffd7d0, 0.82);
      rim.position.set(1, 13, -8);
      scene.add(rim);
      const interior = new THREE.PointLight(0xffb46f, 14, 8, 2);
      interior.position.set(-0.6, 3.1, -2.3);
      scene.add(interior);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.MeshStandardMaterial({ color: 0xadb5ac, roughness: 1, metalness: 0 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1.42;
      floor.receiveShadow = true;
      scene.add(floor);

      function restoreGroundMaterial(material, isBaseSide = false) {
        material.color.set(0xffffff);
        material.roughness = 0.96;
        material.onBeforeCompile = shader => {
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vSakuraWorld;')
            .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSakuraWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
              varying vec3 vSakuraWorld;
              float sakuraHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
              float sakuraNoise(vec2 p) {
                vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
                return mix(mix(sakuraHash(i), sakuraHash(i + vec2(1.0, 0.0)), f.x),
                           mix(sakuraHash(i + vec2(0.0, 1.0)), sakuraHash(i + vec2(1.0)), f.x), f.y);
              }
              float sakuraFbm(vec2 p) {
                float value = 0.0; float amplitude = 0.5;
                for (int i = 0; i < 4; i++) { value += amplitude * sakuraNoise(p); p = p * 2.03 + 17.1; amplitude *= 0.5; }
                return value;
              }
            `)
            .replace('#include <color_fragment>', `#include <color_fragment>
              float largePatch = sakuraFbm(vSakuraWorld.xz * 0.48);
              float fineGrain = sakuraNoise(vSakuraWorld.xz * 5.5);
              vec3 dryMoss = vec3(0.30, 0.35, 0.22);
              vec3 deepMoss = vec3(0.18, 0.27, 0.16);
              vec3 groundColor = mix(dryMoss, deepMoss, smoothstep(0.28, 0.78, largePatch));
              groundColor *= 0.92 + fineGrain * 0.16;
              float riverCenter = 4.0 - 0.65 * sin(vSakuraWorld.x * 0.55) - 0.20 * sin(vSakuraWorld.x * 1.15);
              float wetBank = 1.0 - smoothstep(0.75, 1.55, abs(vSakuraWorld.z - riverCenter));
              diffuseColor.rgb = mix(groundColor, vec3(0.13, 0.20, 0.17), wetBank * 0.62);
              ${isBaseSide ? `
                float verticalGrain = sakuraNoise(vec2(vSakuraWorld.x * 1.7 + vSakuraWorld.z * 1.3, vSakuraWorld.y * 12.0));
                float soilPocket = sakuraFbm(vSakuraWorld.xz * 0.82 + vec2(vSakuraWorld.y * 2.2, -vSakuraWorld.y * 1.6));
                vec3 soilColor = mix(groundColor * 0.64, vec3(0.16, 0.20, 0.125), smoothstep(0.30, 0.74, soilPocket));
                float mossCap = smoothstep(0.25, 0.45, vSakuraWorld.y);
                diffuseColor.rgb = mix(soilColor, groundColor, mossCap * 0.90);
                diffuseColor.rgb *= 0.88 + verticalGrain * 0.22;
              ` : ''}
            `);
        };
        material.customProgramCacheKey = () => isBaseSide ? 'sakura-base-earth-world-v2' : 'sakura-ground-world-v2';
        material.needsUpdate = true;
      }

      const waterTimeUniform = { value: 0 };
      function restoreWaterMaterial(material) {
        material.color.set(0x8bbdb8);
        material.roughness = 0.075;
        material.metalness = 0;
        material.transparent = true;
        material.opacity = 0.30;
        material.depthWrite = false;
        material.side = THREE.DoubleSide;
        if ('transmission' in material) material.transmission = 0;
        if ('ior' in material) material.ior = 1.333;
        if ('thickness' in material) material.thickness = 0;
        if ('attenuationColor' in material) material.attenuationColor.set(0x9bcac5);
        if ('attenuationDistance' in material) material.attenuationDistance = 2;
        material.onBeforeCompile = shader => {
          shader.uniforms.uSakuraWaterTime = waterTimeUniform;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uSakuraWaterTime;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              transformed.y += sin(position.x * 4.1 + uSakuraWaterTime * 0.72)
                * sin(position.z * 3.4 - uSakuraWaterTime * 0.48) * 0.006;
            `);
        };
        material.customProgramCacheKey = () => 'sakura-water-waves-v1';
        material.needsUpdate = true;
      }

      const gardenTimeUniform = { value: 0 };
      function restoreGardenWindMaterial(material) {
        material.onBeforeCompile = shader => {
          shader.uniforms.uSakuraGardenTime = gardenTimeUniform;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uSakuraGardenTime;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              vec3 sakuraPlantWorld = (modelMatrix * vec4(position, 1.0)).xyz;
              float groundWeight = smoothstep(0.055, 0.38, sakuraPlantWorld.y - 0.40);
              float potWeight = smoothstep(1.47, 1.86, sakuraPlantWorld.y);
              float windWeight = sakuraPlantWorld.y > 1.20 ? potWeight : groundWeight;
              float phase = sakuraPlantWorld.x * 1.17 + sakuraPlantWorld.z * 0.83;
              float gust = sin(uSakuraGardenTime * 0.74 + phase) * 0.68
                + sin(uSakuraGardenTime * 1.31 + phase * 0.47) * 0.32;
              transformed.x += gust * 0.024 * windWeight;
              transformed.z += cos(uSakuraGardenTime * 0.61 + phase * 0.72) * 0.013 * windWeight;
            `);
        };
        material.customProgramCacheKey = () => 'sakura-garden-shared-wind-v1';
        material.needsUpdate = true;
      }

      loadingState.textContent = '载入模型与贴图';
      const dracoLoader = new DRACOLoader().setWorkerLimit(2);
      dracoLoader._loadLibrary = async url => {
        if (url === 'draco_wasm_wrapper.js') return window.__SAKURA_ASSETS__.dracoWrapper;
        if (url === 'draco_decoder.wasm') return decodeInlineBase64(window.__SAKURA_ASSETS__.dracoWasm);
        throw new Error('当前浏览器缺少 WebAssembly，无法解码三维模型。');
      };
      const gltfLoader = new GLTFLoader().setDRACOLoader(dracoLoader);
      loadingState.textContent = '展开内嵌模型';
      loadingBar.style.width = '62%';
      await new Promise(resolve => requestAnimationFrame(resolve));
      const glbBuffer = decodeInlineBase64(window.__SAKURA_ASSETS__.glb);
      loadingState.textContent = '解码花瓣、屋面与贴图';
      loadingBar.style.width = '78%';
      const gltf = await gltfLoader.parseAsync(glbBuffer, '');
      dracoLoader.dispose();
      window.__SAKURA_ASSETS__.glb = null;
      window.__SAKURA_ASSETS__.dracoWasm = null;
      window.__SAKURA_ASSETS__.dracoWrapper = null;
      const model = gltf.scene;
      const materialSet = new Set();
      const paperMaterials = new Set();
      const lampMaterials = new Set();
      const waterMaterials = new Set();
      const backdropMaterials = new Set();
      let meshCount = 0;
      let sourceTriangles = 0;
      model.traverse(object => {
        if (!object.isMesh) return;
        meshCount++;
        object.castShadow = !object.name.includes('Stream');
        object.receiveShadow = true;
        const geometry = object.geometry;
        if (geometry.index) sourceTriangles += geometry.index.count / 3;
        else if (geometry.attributes.position) sourceTriangles += geometry.attributes.position.count / 3;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          materialSet.add(material);
          material.envMapIntensity = 0.52;
          const maxAnisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
          for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
            if (material[slot]) {
              material[slot].anisotropy = maxAnisotropy;
              material[slot].needsUpdate = true;
            }
          }
          if (/Mossy_Ground/i.test(material.name)) restoreGroundMaterial(material, false);
          if (/Base_Earth/i.test(material.name)) restoreGroundMaterial(material, true);
          if (/Clear_Shallow_Water/i.test(material.name)) {
            restoreWaterMaterial(material);
            waterMaterials.add(material);
          }
          if (/Paper_Lamp_Warm/i.test(material.name)) lampMaterials.add(material);
          if (/Washi|Background_Pale_Frame|Linen/i.test(material.name)) backdropMaterials.add(material);
          if (/Shouji|Shoji/i.test(material.name)) paperMaterials.add(material);
          if (/Shouji|Shoji|Washi|Linen/i.test(material.name)) {
            if ('transmission' in material) material.transmission = 0;
            material.roughness = Math.max(material.roughness, 0.82);
          }
          if (/^SM_R5_Stage75_(Garden_|Hosta_(Cupped_Leaves|Petioles|Central_Veins|Lateral_Veins))/.test(object.name)) {
            restoreGardenWindMaterial(material);
          }
          if (/Clear_Flowing_Stream/i.test(object.name)) material.depthWrite = false;
        }
      });
      scene.add(model);
      model.updateMatrixWorld(true);
      const backdropColors = [...backdropMaterials].map(material => ({ material, dayColor: material.color.clone() }));

      // ===== Interactive model parts =====
      const riverCenter = x => 4.0 - 0.65 * Math.sin(x * 0.55) - 0.20 * Math.sin(x * 1.15);
      const riverHalfWidth = x => (1.55 + 0.22 * Math.sin(x * 0.75 + 0.8)) / 2;
      function waterBaseHeight(x, z) {
        const across = 6 * (0.5 + (riverCenter(x) - z) / (riverHalfWidth(x) * 2));
        return 0.205 + 0.012 * Math.sin(x * 4.2 + across * 1.4);
      }
      function waterSurfaceHeight(x, z, time = 0) {
        return waterBaseHeight(x, z) + Math.sin(x * 4.1 + time * 0.72) * Math.sin(z * 3.4 - time * 0.48) * 0.006;
      }
      function isWaterContact(x, z) {
        return Math.abs(z - riverCenter(x)) < riverHalfWidth(x) * 0.96;
      }
      function isPorchContact(x, z) {
        return x >= -4.395 && x <= 2.795 && z >= -5.04 && z <= 0.91;
      }
      function petalContactHeight(x, z, time = 0) {
        if (isWaterContact(x, z)) return waterSurfaceHeight(x, z, time) + 0.003;
        if (isPorchContact(x, z)) return 1.096;
        return terrainHeightAt(x, z) + 0.006;
      }
      const panelWidth = 6.30 / 4; // R5: four panels now fit the true 6.30 m structural opening.
      const doorOffsets = new Map([
        ['SM_Shoji_Left_Outer', 0],
        ['SM_Shoji_Left_Inner', -panelWidth],
        ['SM_Shoji_Right_Inner', panelWidth],
        ['SM_Shoji_Right_Outer', 0],
      ]);
      const doors = [...doorOffsets.keys()].map(name => model.getObjectByName(name)).filter(Boolean);
      const movableDoors = doors.filter(door => doorOffsets.get(door.name) !== 0);
      const doorStates = ['closed', 'half', 'open'];
      let doorState = 'half';
      let doorsOpen = false;
      function setDoorState(next, immediate = false) {
        if (!doorStates.includes(next)) return;
        doorState = next;
        doorsOpen = next === 'open';
        document.querySelector('#enter-room').hidden = !doorsOpen;
        for (const door of doors) {
          const closedX = door.userData.closedX;
          const openX = door.userData.openX;
          const ratio = next === 'open' ? 1 : next === 'half' ? 0.5 : 0;
          door.userData.targetX = closedX + (openX - closedX) * ratio;
          if (immediate || reducedMotion) door.position.x = door.userData.targetX;
        }
      }
      function toggleDoors() {
        const next = doorState === 'half' ? 'open' : doorState === 'open' ? 'closed' : 'half';
        setDoorState(next);
        showToast(next === 'open' ? '中门已全开 · 点击茶室或右上角入室' : next === 'half' ? '中门半开' : '中门已闭合');
      }
      for (const door of doors) {
        door.userData.closedX = door.position.x;
        door.userData.openX = door.position.x + doorOffsets.get(door.name);
      }
      setDoorState('half', true);

      const waterMesh = model.getObjectByName('SM_Clear_Flowing_Stream');
      const fish = [];
      for (let index = 0; index < 12; index++) {
        const object = model.getObjectByName(`WEB_Koi_${String(index).padStart(2, '0')}`);
        if (!object) continue;
        fish.push({
          object,
          base: object.position.clone(),
          baseRotationY: object.rotation.y,
          phase: index * 0.91,
          offsetZ: object.position.z - riverCenter(object.position.x),
        });
      }
      const koiTimeUniform = { value: 0 };
      for (const koi of fish) {
        koi.speed = 0.20 + (koi.phase % 0.7) * 0.08;
        koi.object.traverse(object => {
          if (!object.isMesh) return;
          const cloneWithSwim = material => {
            const clone = material.clone();
            clone.onBeforeCompile = shader => {
              shader.uniforms.uKoiTime = koiTimeUniform;
              shader.uniforms.uKoiPhase = { value: koi.phase };
              shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nuniform float uKoiTime;\nuniform float uKoiPhase;')
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                  float tailWeight = 1.0 - smoothstep(-0.12, 0.36, position.x);
                  transformed.z += sin(uKoiTime * 3.4 + uKoiPhase + position.x * 7.0) * 0.038 * tailWeight;
                `);
            };
            clone.customProgramCacheKey = () => 'sakura-koi-swim-v1';
            clone.needsUpdate = true;
            return clone;
          };
          object.material = Array.isArray(object.material) ? object.material.map(cloneWithSwim) : cloneWithSwim(object.material);
        });
      }
      const ribbons = [];
      model.traverse(object => {
        if (!object.isMesh || !/^SM_Sakura_(Silk_Ribbon|Wooden_Tag)/.test(object.name)) return;
        ribbons.push({ object, base: object.rotation.clone(), phase: ribbons.length * 0.73 });
      });

      // r5_stage74_tree_layout=1: Blender Hero (-6.25,3.20,0.442051), Secondary (5.90,4.55,0.455257); Small unchanged.
      const treeEmitters = [
        { name: '大樱树', x: -6.25, z: -3.20, y: 4.642051, radius: 2.65, height: 5.642051, burst: 260 },
        { name: '中樱树', x: 5.90, z: -4.55, y: 3.565257, radius: 2.00, height: 4.365257, burst: 160 },
        { name: '小樱树', x: -6.7, z: 1.00, y: 2.10, radius: 1.35, height: 2.75, burst: 90 },
      ];
      const treeHitTargets = treeEmitters.map((tree, index) => {
        const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
        const target = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), material);
        const topCrownCompensation = index === 0 ? 0.28 : 0.10;
        target.position.set(tree.x, tree.y + topCrownCompensation, tree.z);
        target.scale.set(tree.radius * 1.06, tree.radius * (index === 0 ? 0.70 : 0.58), tree.radius * 1.06);
        target.userData.treeIndex = index;
        scene.add(target);
        return target;
      });

      let roomMode = false;
      let cameraTween = null;
      let savedExteriorView = null;
      const roomPosition = new THREE.Vector3(-0.85, 2.65, 1.40);
      const roomTarget = new THREE.Vector3(-0.85, 1.60, -2.20);
      const insideBox = new THREE.Box3(new THREE.Vector3(-3.65, 1.05, -3.50), new THREE.Vector3(2.45, 3.60, -1.00));
      const sceneHint = document.querySelector('#scene-hint');
      const cameraToggle = document.querySelector('#camera-toggle');
      const handbookPanels = ['guide-panel', 'sound-panel', 'camera-panel'];
      const handbookTriggerSelectors = { 'guide-panel': '#guide-toggle', 'sound-panel': '#sound-settings', 'camera-panel': '#camera-toggle' };
      let activeHandbookPanel = null;
      function closeHandbookPanels(restoreFocus = false) {
        const previousPanel = activeHandbookPanel;
        for (const id of handbookPanels) document.querySelector(`#${id}`).hidden = true;
        document.querySelector('#guide-toggle').setAttribute('aria-expanded', 'false');
        document.querySelector('#sound-settings').setAttribute('aria-expanded', 'false');
        cameraToggle.setAttribute('aria-expanded', 'false');
        activeHandbookPanel = null;
        if (restoreFocus && previousPanel) document.querySelector(handbookTriggerSelectors[previousPanel]).focus({ preventScroll: true });
      }
      function openHandbookPanel(id) {
        if (id === 'camera-panel' && roomMode) return;
        const shouldOpen = document.querySelector(`#${id}`).hidden;
        closeHandbookPanels();
        if (!shouldOpen) return;
        document.querySelector(`#${id}`).hidden = false;
        activeHandbookPanel = id;
        const trigger = handbookTriggerSelectors[id];
        document.querySelector(trigger).setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => document.querySelector(`#${id} [data-close-panel]`)?.focus({ preventScroll: true }));
      }
      document.querySelector('#guide-toggle').addEventListener('click', () => openHandbookPanel('guide-panel'));
      document.querySelector('#sound-settings').addEventListener('click', () => openHandbookPanel('sound-panel'));
      cameraToggle.addEventListener('click', () => openHandbookPanel('camera-panel'));
      document.querySelector('#guide-open-sound').addEventListener('click', () => openHandbookPanel('sound-panel'));
      document.querySelector('#guide-open-camera').addEventListener('click', () => openHandbookPanel('camera-panel'));
      document.querySelectorAll('[data-close-panel]').forEach(button => button.addEventListener('click', () => closeHandbookPanels(true)));

      const cameraPresets = {
        home: { label: '庭院主视角', position: [19.8, 19.7, 26.5], target: [0, 2.25, -0.25], fov: 35 },
        stream: { label: '溪石听水', position: [7.8, 3.4, 10.5], target: [0, 0.35, 4], fov: 42 },
        tree: { label: '花下观树', position: [-13.2, 5.8, 7.2], target: [-5.8, 3.1, -2.9], fov: 42 },
        roof: { label: '檐影闻铃', position: [7.0, 5.0, 7.4], target: [1.4, 3.45, -0.2], fov: 40 },
        approach: { label: '穿桥见院', position: [6.8, 4.0, 11.5], target: [-0.8, 1.0, 1.6], fov: 40 },
        tea: { label: '茶室入口', position: [0, 3.4, 7.8], target: [-0.85, 1.95, -1.6], fov: 42 },
      };
      let activeCameraPreset = 'home';
      function updateCameraPresetControls() {
        document.querySelectorAll('[data-shot]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shot === activeCameraPreset)));
        const label = roomMode ? '茶室内' : cameraPresets[activeCameraPreset]?.label || '自由视角';
        document.querySelector('#camera-current').textContent = `当前：${label}`;
      }
      function cancelCameraTween() {
        if (!cameraTween || cameraTween.kind !== 'manual') return;
        cameraTween = null; controls.enabled = true; activeCameraPreset = null;
        controls.update(); updateCameraPresetControls();
      }
      function selectCameraPreset(id) {
        const preset = cameraPresets[id];
        if (!preset || roomMode || (cameraTween && cameraTween.kind !== 'manual')) return;
        activeCameraPreset = id; userMoved = id !== 'home';
        updateCameraPresetControls();
        startCameraTween(new THREE.Vector3(...preset.position), new THREE.Vector3(...preset.target), undefined, preset.fov, 'manual');
      }
      document.querySelectorAll('[data-shot]').forEach(button => button.addEventListener('click', () => selectCameraPreset(button.dataset.shot)));
      controls.addEventListener('start', () => {
        if (!cameraTween && !roomMode) { activeCameraPreset = null; updateCameraPresetControls(); }
      });
      canvas.addEventListener('pointerdown', () => {
        if (cameraTween && cameraTween.kind === 'manual') cancelCameraTween();
      }, { capture: true });
      updateCameraPresetControls();
      window.__SAKURA_CAMERA_STATE__ = () => ({
        activePreset: activeCameraPreset, position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov,
        tween: cameraTween ? { kind: cameraTween.kind, started: cameraTween.started, duration: cameraTween.duration } : null,
        roomMode, presets: cameraPresets,
      });

      function startCameraTween(endPosition, endTarget, onComplete, endFov = camera.fov, kind = 'room') {
        if (reducedMotion) {
          cameraTween = null;
          camera.position.copy(endPosition); controls.target.copy(endTarget);
          camera.fov = endFov; camera.updateProjectionMatrix(); camera.lookAt(endTarget);
          controls.enabled = true; onComplete?.();
          return;
        }
        cameraTween = {
          started: performance.now(), duration: 1750, kind,
          fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), fromFov: camera.fov,
          endPosition: endPosition.clone(), endTarget: endTarget.clone(), endFov, onComplete,
        };
        controls.enabled = false;
      }
      function updateCameraTween(now) {
        if (!cameraTween) return;
        const tween = cameraTween;
        const linear = Math.min(1, (now - tween.started) / tween.duration);
        const eased = linear * linear * (3 - 2 * linear);
        camera.position.lerpVectors(tween.fromPosition, tween.endPosition, eased);
        controls.target.lerpVectors(tween.fromTarget, tween.endTarget, eased);
        camera.fov = THREE.MathUtils.lerp(tween.fromFov, tween.endFov, eased);
        camera.updateProjectionMatrix();
        camera.lookAt(controls.target);
        if (linear >= 1) {
          cameraTween = null;
          controls.enabled = true;
          tween.onComplete?.();
        }
      }
      function enterRoom() {
        if (roomMode || cameraTween) return;
        if (!doorsOpen) {
          showToast('请先点击中门，切换至全开');
          return;
        }
        savedExteriorView = {
          position: camera.position.clone(), target: controls.target.clone(),
          minDistance: controls.minDistance, maxDistance: controls.maxDistance,
          minPolarAngle: controls.minPolarAngle, maxPolarAngle: controls.maxPolarAngle,
          minAzimuthAngle: controls.minAzimuthAngle, maxAzimuthAngle: controls.maxAzimuthAngle,
          fov: camera.fov,
          glassVisible: glassCover.visible,
          cameraPreset: activeCameraPreset,
        };
        roomMode = true;
        document.querySelector('#enter-room').hidden = true;
        activeCameraPreset = null;
        closeHandbookPanels();
        setGlassCoverVisible(false, false);
        glassButton.disabled = true;
        cameraToggle.disabled = true;
        updateCameraPresetControls();
        document.body.classList.add('room');
        sceneHint.textContent = '拖拽有限环顾 · 滚轮微调 · 返回庭院';
        startCameraTween(roomPosition, roomTarget, () => {
          controls.minDistance = 1.40;
          controls.maxDistance = 3.60;
          controls.minPolarAngle = 1.15;
          controls.maxPolarAngle = 1.70;
          controls.minAzimuthAngle = -0.65;
          controls.maxAzimuthAngle = 0.65;
          controls.update();
        }, 52);
        showToast('已进入茶室');
      }
      function exitRoom() {
        if (!roomMode || cameraTween || !savedExteriorView) return;
        const saved = savedExteriorView;
        startCameraTween(saved.position, saved.target, () => {
          controls.minDistance = saved.minDistance;
          controls.maxDistance = saved.maxDistance;
          controls.minPolarAngle = saved.minPolarAngle;
          controls.maxPolarAngle = saved.maxPolarAngle;
          controls.minAzimuthAngle = saved.minAzimuthAngle;
          controls.maxAzimuthAngle = saved.maxAzimuthAngle;
          camera.fov = saved.fov;
          camera.updateProjectionMatrix();
          controls.update();
          glassButton.disabled = false;
          cameraToggle.disabled = false;
          setGlassCoverVisible(saved.glassVisible, false);
          roomMode = false;
          document.querySelector('#enter-room').hidden = !doorsOpen;
          activeCameraPreset = saved.cameraPreset || 'home';
          updateCameraPresetControls();
          savedExteriorView = null;
          document.body.classList.remove('room');
          sceneHint.textContent = '拖拽环视 · 滚轮靠近 · 点门、樱树、水面、风铃与玻璃罩';
        }, saved.fov);
      }
      document.querySelector('#exit-room').addEventListener('click', exitRoom);
      document.querySelector('#enter-room').addEventListener('click', enterRoom);

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let pointerStart = null;
      canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
        const rect = canvas.getBoundingClientRect();
        pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const modelHit = raycaster.intersectObject(model, true)[0];
        diagnosticsPanel.dataset.lastHit = modelHit ? modelHit.object.name : '';
        diagnosticsPanel.dataset.lastHitPoint = modelHit ? modelHit.point.toArray().map(value => value.toFixed(3)).join(',') : '';
      });
      canvas.addEventListener('pointerup', event => {
        if (!pointerStart || event.button !== 0 || cameraTween || roomMode) return;
        const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
        const elapsed = performance.now() - pointerStart.time;
        pointerStart = null;
        if (distance > 7 || elapsed > 500) return;
        const rect = canvas.getBoundingClientRect();
        pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const targets = [...movableDoors, ...treeHitTargets, ...glassBaseTargets, windChime];
        if (waterMesh) targets.push(waterMesh);
        const hit = raycaster.intersectObjects(targets, true)[0];
        if (hit && movableDoors.some(door => door === hit.object || door.children.includes(hit.object))) {
          toggleDoors();
          return;
        }
        if (hit && (hit.object === windChime || windChime.children.includes(hit.object))) {
          playWindChime();
          return;
        }
        if (hit && insideBox.containsPoint(hit.point)) {
          enterRoom();
          return;
        }
        if (hit && Number.isInteger(hit.object.userData.treeIndex)) {
          spawnPetalBurst(hit.object.userData.treeIndex);
          playPetalAir(treeEmitters[hit.object.userData.treeIndex]);
          return;
        }
        if (hit && waterMesh && (hit.object === waterMesh || waterMesh.children.includes(hit.object))) {
          spawnRipple(hit.point);
          return;
        }
        if (hit && glassBaseTargets.includes(hit.object)) {
          toggleGlassCover();
          return;
        }
        if (glassCover.visible && raycaster.intersectObjects([glassCover, coverEdges], false).length) {
          toggleGlassCover();
          return;
        }
        if (raycaster.ray.intersectBox(insideBox, new THREE.Vector3())) enterRoom();
      });

      const ripples = [];
      const rippleGeometry = new THREE.PlaneGeometry(2, 2);
      function spawnRipple(point) {
        const material = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          uniforms: { uAge: { value: reducedMotion ? 0.8 : 0 }, uDuration: { value: 2.6 }, uColor: { value: new THREE.Color(0xd9f2ec) } },
          vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: `
            varying vec2 vUv; uniform float uAge; uniform float uDuration; uniform vec3 uColor;
            void main() {
              float t = uAge / uDuration;
              if (t <= 0.0 || t >= 1.0) discard;
              float radius = length((vUv - 0.5) * 2.0);
              float fade = pow(1.0 - t, 1.45) * smoothstep(0.0, 0.07, t);
              float wave1 = exp(-pow((radius - t * 0.88) * 38.0, 2.0));
              float wave2 = exp(-pow((radius - t * 0.63) * 48.0, 2.0)) * 0.65;
              float wave3 = exp(-pow((radius - t * 0.39) * 58.0, 2.0)) * 0.35;
              float shimmer = 0.88 + 0.12 * sin(radius * 85.0 - uAge * 8.0);
              float alpha = (wave1 + wave2 + wave3) * fade * shimmer * 0.58;
              if (alpha < 0.004) discard;
              gl_FragColor = vec4(uColor, alpha);
            }
          `,
        });
        const ring = new THREE.Mesh(rippleGeometry, material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(point.x, waterSurfaceHeight(point.x, point.z, waterTimeUniform.value) + 0.004, point.z);
        ring.scale.setScalar(1.35);
        ring.renderOrder = 4;
        scene.add(ring);
        ripples.push(ring);
        if (ripples.length > 8) {
          const oldest = ripples.shift();
          scene.remove(oldest);
          oldest.material.dispose();
        }
      }
      function updateRipples(delta) {
        for (let index = ripples.length - 1; index >= 0; index--) {
          const ring = ripples[index];
          ring.position.y = waterSurfaceHeight(ring.position.x, ring.position.z, waterTimeUniform.value) + 0.004;
          ring.material.uniforms.uAge.value += delta * (reducedMotion ? 4 : 1);
          if (ring.material.uniforms.uAge.value >= ring.material.uniforms.uDuration.value) {
            scene.remove(ring);
            ring.material.dispose();
            ripples.splice(index, 1);
          }
        }
      }

      // ===== Warm garden lighting =====
      const gardenLights = [];
      const gardenGlowMaterials = [];
      const crownLights = [];
      const lanternWood = new THREE.MeshStandardMaterial({ color: 0x4f4033, roughness: 0.74 });
      let riverStoneSource = null;
      model.traverse(object => {
        if (riverStoneSource || !object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        riverStoneSource = materials.find(material => material?.name === 'MAT_River_Stone_PBR' && material.map) || null;
      });
      const lanternStone = riverStoneSource
        ? riverStoneSource.clone()
        : new THREE.MeshStandardMaterial({ color: 0x74796e, roughness: 0.96 });
      lanternStone.name = 'Garden_Lantern_Base_River_Stone_PBR';
      lanternStone.roughness = 0.93;
      lanternStone.metalness = 0;
      lanternStone.needsUpdate = true;
      const lanternMetal = new THREE.MeshStandardMaterial({ color: 0x4b443a, roughness: 0.48, metalness: 0.68 });

      // A closed, flat-shaded hip roof replaces the four-sided cone primitive.
      // Base winding faces downward; every slope has an explicit outward winding.
      function createHipRoofGeometry(width, depth, height) {
        const x = width / 2;
        const z = depth / 2;
        const indexed = new THREE.BufferGeometry();
        indexed.setAttribute('position', new THREE.Float32BufferAttribute([
          -x, 0, -z,   x, 0, -z,   x, 0, z,   -x, 0, z,   0, height, 0,
        ], 3));
        indexed.setIndex([
          0, 4, 1,  1, 4, 2,  2, 4, 3,  3, 4, 0,
          0, 1, 2,  0, 2, 3,
        ]);
        const geometry = indexed.toNonIndexed();
        indexed.dispose();
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        return geometry;
      }

      function createLantern(x, z, groundY) {
        const group = new THREE.Group();
        group.name = x < 0 ? 'Garden_Ground_Lantern_Left' : 'Garden_Ground_Lantern_Right';
        group.position.set(x, groundY, z);
        group.userData.groundContact = groundY;
        group.userData.roofConstruction = 'closed_hip_flat_shaded';
        function addPart(geometry, material, y, castShadow = true) {
          const part = new THREE.Mesh(geometry, material);
          part.position.y = y;
          part.castShadow = castShadow;
          part.receiveShadow = true;
          group.add(part);
          return part;
        }
        function addRoofRod(start, end) {
          const direction = end.clone().sub(start);
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, direction.length(), 8), lanternWood);
          rod.position.copy(start).add(end).multiplyScalar(0.5);
          rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
          rod.castShadow = true;
          rod.receiveShadow = true;
          group.add(rod);
        }
        const baseProfile = [
          new THREE.Vector2(0, 0), new THREE.Vector2(0.27, 0),
          new THREE.Vector2(0.285, 0.032), new THREE.Vector2(0.25, 0.095),
          new THREE.Vector2(0.22, 0.12), new THREE.Vector2(0.22, 0.145),
          new THREE.Vector2(0.16, 0.175), new THREE.Vector2(0, 0.175),
        ];
        addPart(new THREE.LatheGeometry(baseProfile, 32), lanternStone, 0);
        addPart(new THREE.CylinderGeometry(0.064, 0.086, 0.70, 16), lanternWood, 0.51);
        for (const y of [0.225, 0.82]) {
          addPart(new THREE.CylinderGeometry(0.102, 0.102, 0.045, 24), lanternMetal, y);
        }
        addPart(new THREE.BoxGeometry(0.43, 0.05, 0.43), lanternWood, 0.865);
        const glow = new THREE.MeshStandardMaterial({
          color: 0xe3d7bc, roughness: 0.88, emissive: 0xffb562, emissiveIntensity: 0,
        });
        gardenGlowMaterials.push(glow);
        addPart(new THREE.BoxGeometry(0.335, 0.355, 0.335), glow, 1.065, false);
        for (const dx of [-0.18, 0.18]) {
          for (const dz of [-0.18, 0.18]) {
            const bar = addPart(new THREE.BoxGeometry(0.026, 0.405, 0.026), lanternWood, 1.065);
            bar.position.x = dx;
            bar.position.z = dz;
          }
        }
        for (const side of [-1, 1]) {
          const frontRail = addPart(new THREE.BoxGeometry(0.385, 0.020, 0.022), lanternWood, 1.065);
          frontRail.position.z = side * 0.181;
          const sideRail = addPart(new THREE.BoxGeometry(0.022, 0.020, 0.385), lanternWood, 1.065);
          sideRail.position.x = side * 0.181;
          const frontMullion = addPart(new THREE.BoxGeometry(0.018, 0.355, 0.020), lanternWood, 1.065);
          frontMullion.position.z = side * 0.183;
          const sideMullion = addPart(new THREE.BoxGeometry(0.020, 0.355, 0.018), lanternWood, 1.065);
          sideMullion.position.x = side * 0.183;
        }
        addPart(new THREE.BoxGeometry(0.47, 0.052, 0.47), lanternWood, 1.285);
        addPart(createHipRoofGeometry(0.52, 0.52, 0.19), lanternWood, 1.311);
        for (const [dx, dz] of [[-0.26, -0.26], [0.26, -0.26], [0.26, 0.26], [-0.26, 0.26]]) {
          addRoofRod(new THREE.Vector3(dx, 1.313, dz), new THREE.Vector3(0, 1.503, 0));
        }
        addPart(new THREE.CylinderGeometry(0.032, 0.042, 0.075, 16), lanternMetal, 1.525);
        addPart(new THREE.SphereGeometry(0.042, 16, 10), lanternMetal, 1.57);
        const light = new THREE.PointLight(0xffb66f, 0, 5.5, 2);
        light.position.set(0, 1.065, 0);
        group.add(light);
        gardenLights.push(light);
        scene.add(group);
      }
      createLantern(-3.15, 1.65, 0.4550649185180664);
      createLantern(1.55, 1.65, 0.45616259765625);
      function createCrownLight(x, z, targetY) {
        const light = new THREE.SpotLight(0xffc58a, 0, 15, Math.PI / 5.2, 0.68, 1.4);
        light.position.set(x, 0.42, z + 0.35);
        light.target.position.set(x, targetY, z);
        scene.add(light, light.target);
        crownLights.push(light);
      }
      createCrownLight(-6.45, -2.35, 6.3);
      createCrownLight(5.90, -2.95, 5.6);

      const hangingLanterns = [];
      // r5_fixture_feedback_pass=1: measured current SM_Eave_Timber underside is Y=3.63, centre Z=0.15.
      function createHangingLantern(x) {
        const group = new THREE.Group();
        group.name = x < 0 ? 'Eave_Hanging_Lantern_Left' : 'Eave_Hanging_Lantern_Right';
        group.position.set(x, 3.63, 0.15);
        group.userData.beamAttachment = { beam: 'SM_Eave_Timber', undersideY: 3.63, centreZ: 0.15, chainTopLocalY: 0 };
        const chainLength = 0.395;
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, chainLength, 8), chimeSafeMetal());
        chain.position.y = -chainLength / 2;
        group.add(chain);
        const paper = new THREE.MeshStandardMaterial({ color: 0xe8d8b9, roughness: 0.82, emissive: 0xffb56a, emissiveIntensity: 0.04 });
        const wood = lanternWood;
        const roof = new THREE.Mesh(createHipRoofGeometry(0.43, 0.43, 0.17), wood);
        roof.position.y = -0.565;
        group.add(roof);
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.34), paper);
        body.position.y = -0.69;
        group.add(body);
        for (const y of [-0.50, -0.90]) {
          const frame = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.055, 0.43), wood);
          frame.position.y = y;
          group.add(frame);
        }
        for (const dx of [-0.18, 0.18]) for (const dz of [-0.18, 0.18]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.42, 0.026), wood);
          bar.position.set(dx, -0.69, dz);
          group.add(bar);
        }
        const finial = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.12, 8), wood);
        finial.rotation.x = Math.PI;
        finial.position.y = -0.99;
        group.add(finial);
        const light = new THREE.PointLight(0xffc27d, 0, 3.2, 2);
        light.position.y = -0.69;
        group.add(light);
        group.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
        scene.add(group);
        hangingLanterns.push({ group, paper, light });
      }
      function chimeSafeMetal() {
        return new THREE.MeshStandardMaterial({ color: 0x5e5144, roughness: 0.68, metalness: 0.25 });
      }
      createHangingLantern(-2.40);
      createHangingLantern(0.80);

      // ===== Glass wind chime =====
      const windChime = new THREE.Group();
      windChime.name = 'Eave_Glass_Wind_Chime';
      windChime.position.set(3.02, 3.63, 0.15);
      windChime.userData.beamAttachment = { beam: 'SM_Eave_Timber', undersideY: 3.63, centreZ: 0.15, cordTopLocalY: 0 };
      const chimeLineMaterial = new THREE.MeshStandardMaterial({ color: 0x756a5e, roughness: 0.8 });
      const chimeGlass = new THREE.MeshStandardMaterial({
        color: 0xc6e0dc, roughness: 0.12, metalness: 0.08, transparent: true, opacity: 0.46,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const chimePaper = new THREE.MeshStandardMaterial({ color: 0xdfb9bd, roughness: 0.9, side: THREE.DoubleSide });
      const chimeString = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.34, 6), chimeLineMaterial);
      chimeString.position.y = -0.17;
      windChime.add(chimeString);
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.115, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), chimeGlass);
      bell.position.y = -0.40;
      windChime.add(bell);
      const bellRim = new THREE.Mesh(new THREE.TorusGeometry(0.106, 0.006, 8, 28), chimeGlass);
      bellRim.rotation.x = Math.PI / 2;
      bellRim.position.y = -0.47;
      windChime.add(bellRim);
      const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), chimeLineMaterial);
      clapper.position.y = -0.49;
      windChime.add(clapper);
      const stripGeometry = new THREE.PlaneGeometry(0.12, 0.34, 1, 3);
      const stripPositions = stripGeometry.attributes.position;
      for (let index = 0; index < stripPositions.count; index++) {
        stripPositions.setZ(index, Math.sin(stripPositions.getY(index) * 8) * 0.016);
      }
      stripGeometry.computeVertexNormals();
      const strip = new THREE.Mesh(stripGeometry, chimePaper);
      strip.position.y = -0.75;
      windChime.add(strip);
      // A small, invisible tolerance volume keeps the click target reliable while the chime sways.
      const windChimeHitTarget = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 1.04, 0.42),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
      );
      windChimeHitTarget.name = 'Eave_Glass_Wind_Chime_Hit_Target';
      windChimeHitTarget.position.y = -0.45;
      windChime.add(windChimeHitTarget);
      scene.add(windChime);

      // Stage 7.6 — one real-recording audio engine; no synthetic wind chime remains.
      // The global switch is never persisted: every fresh visit starts silent.
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      let soundEnabled = false;
      let masterVolume = 0.40;
      const soundLayers = { water: true, bell: true, petal: true };
      const audioBuffers = { water: null, bell: null, petal: null };
      const audioLayerGains = { water: null, bell: null, petal: null };
      const audioEncodedBytes = { water: 0, bell: 0, petal: 0 };
      const activeOneShots = new Set();
      let audioContext = null;
      let audioMaster = null;
      let audioLimiter = null;
      let audioAnalyser = null;
      let audioDecodePromise = null;
      let waterSource = null;
      let waterSourceGain = null;
      let waterPanner = null;
      let windChimeHitCount = 0;
      let windChimeSoundCount = 0;
      let petalSoundCount = 0;
      let lastWindChimeHitAt = null;
      let lastWindChimeSoundAt = null;
      let lastPetalSoundAt = null;
      let lastAudioListenerUpdate = 0;
      let audioVisibilitySuspendCount = 0;
      let audioVisibilityResumeCount = 0;
      let lastAudioVisibilityState = document.visibilityState;
      const audioForward = new THREE.Vector3();
      const audioUp = new THREE.Vector3();

      function rampAudioParam(param, value, seconds = 0.05) {
        if (!audioContext || !param) return;
        const now = audioContext.currentTime;
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(value, now + seconds);
      }
      function createAudioPanner(position, refDistance = 12, rolloffFactor = 0.75) {
        const panner = audioContext.createPanner();
        panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
        panner.refDistance = refDistance; panner.maxDistance = 80; panner.rolloffFactor = rolloffFactor;
        if (panner.positionX) {
          panner.positionX.value = position[0]; panner.positionY.value = position[1]; panner.positionZ.value = position[2];
        } else { panner.setPosition(position[0], position[1], position[2]); }
        return panner;
      }
      function syncWaterLoop() {
        if (!audioContext || audioContext.state !== 'running' || waterSource || !audioBuffers.water || !soundEnabled || !soundLayers.water || document.hidden) return;
        waterSource = audioContext.createBufferSource();
        waterSource.buffer = audioBuffers.water; waterSource.loop = true;
        waterSource.loopStart = 0; waterSource.loopEnd = audioBuffers.water.duration;
        waterSourceGain = audioContext.createGain(); waterSourceGain.gain.value = 0.75;
        waterPanner = createAudioPanner([0, 0.35, 4], 9, 0.85);
        waterSource.connect(waterSourceGain); waterSourceGain.connect(waterPanner); waterPanner.connect(audioLayerGains.water);
        waterSource.onended = () => {
          for (const node of [waterSource, waterSourceGain, waterPanner]) { if (node) { try { node.disconnect(); } catch (_) {} } }
          waterSource = null; waterSourceGain = null; waterPanner = null;
        };
        waterSource.start();
      }
      function updateAudioLevels() {
        if (!audioContext || !audioMaster) return;
        rampAudioParam(audioMaster.gain, soundEnabled && !document.hidden ? masterVolume : 0);
        for (const kind of ['water', 'bell', 'petal']) {
          if (audioLayerGains[kind]) rampAudioParam(audioLayerGains[kind].gain, soundLayers[kind] ? 1 : 0);
        }
        syncWaterLoop();
      }
      function decodeAudioBase64(encoded) {
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        return bytes;
      }
      async function ensureAudio() {
        if (!soundEnabled || document.hidden || reducedMotion || !AudioContextClass) return false;
        if (!audioContext) {
          audioContext = new AudioContextClass();
          audioMaster = audioContext.createGain(); audioMaster.gain.value = 0;
          audioAnalyser = audioContext.createAnalyser(); audioAnalyser.fftSize = 2048;
          audioLimiter = audioContext.createDynamicsCompressor();
          audioLimiter.threshold.value = -6; audioLimiter.knee.value = 3; audioLimiter.ratio.value = 12;
          audioLimiter.attack.value = 0.003; audioLimiter.release.value = 0.18;
          audioMaster.connect(audioLimiter); audioLimiter.connect(audioAnalyser); audioAnalyser.connect(audioContext.destination);
          for (const kind of ['water', 'bell', 'petal']) {
            const gain = audioContext.createGain(); gain.gain.value = soundLayers[kind] ? 1 : 0;
            gain.connect(audioMaster); audioLayerGains[kind] = gain;
          }
        }
        if (audioContext.state === 'suspended') await audioContext.resume();
        if (!audioDecodePromise && (!audioBuffers.water || !audioBuffers.bell || !audioBuffers.petal)) {
          audioDecodePromise = (async () => {
            const assets = window.__SAKURA_AUDIO__;
            if (!assets || !assets.water || !assets.bell || !assets.petal) throw new Error('Inline audio assets are not packaged.');
            const decoded = {};
            for (const kind of ['water', 'bell', 'petal']) {
              const bytes = decodeAudioBase64(assets[kind]);
              audioEncodedBytes[kind] = bytes.length;
              decoded[kind] = await audioContext.decodeAudioData(bytes.buffer);
            }
            Object.assign(audioBuffers, decoded);
            for (const kind of ['water', 'bell', 'petal']) delete assets[kind];
          })().catch(error => { audioDecodePromise = null; throw error; });
        }
        if (audioDecodePromise) await audioDecodePromise;
        updateAudioLevels();
        return audioContext.state === 'running' && !!(audioBuffers.water && audioBuffers.bell && audioBuffers.petal);
      }
      function updateSoundControls() {
        const soundButton = document.querySelector('#sound-toggle');
        const masterSwitch = document.querySelector('#master-switch');
        soundButton.setAttribute('aria-pressed', String(soundEnabled)); masterSwitch.setAttribute('aria-pressed', String(soundEnabled));
        document.querySelector('#sound-label').textContent = soundEnabled ? '声音·开' : '声音·关';
        masterSwitch.textContent = soundEnabled ? '已开启' : '已关闭';
        document.querySelector('#master-sound-copy').textContent = soundEnabled ? '真实录音已启用 · 隐藏标签页时暂停' : '默认关闭，开启后才解锁与解码';
        document.querySelector('#guide-sound-state').textContent = soundEnabled ? '开启' : '关闭';
        for (const kind of ['water', 'bell', 'petal']) {
          const button = document.querySelector(`[data-layer="${kind}"]`);
          button.setAttribute('aria-pressed', String(soundLayers[kind])); button.textContent = soundLayers[kind] ? '开启' : '关闭';
          document.querySelector(`#guide-${kind}-state`).textContent = (soundLayers[kind] ? '开启' : '关闭') + (soundEnabled ? '' : ' · 待总开关');
        }
        document.querySelector('#volume-value').textContent = `${Math.round(masterVolume * 100)}%`;
        document.querySelector('#master-volume').value = String(Math.round(masterVolume * 100));
      }
      async function setSoundEnabled(next) {
        if (next && reducedMotion) { showToast('系统已启用减少动态效果，声音保持关闭'); return; }
        if (!AudioContextClass) { showToast('当前浏览器不支持 Web Audio'); return; }
        if (next === soundEnabled) { if (next) { try { await ensureAudio(); } catch (_) {} } return; }
        soundEnabled = next; updateSoundControls(); updateAudioLevels();
        if (!next) {
          showToast('庭园声音已关闭');
          window.setTimeout(() => { if (!soundEnabled && audioContext && audioContext.state === 'running') audioContext.suspend().catch(() => {}); }, 70);
          return;
        }
        showToast('正在展开庭园声景…');
        try {
          const ready = await ensureAudio();
          if (!soundEnabled) return;
          if (!ready) throw new Error('Audio did not enter running state.');
          showToast('庭园声音已开启 · 水声、风铃与落瓣各有开关');
        } catch (error) {
          soundEnabled = false; updateSoundControls(); updateAudioLevels(); console.error(error);
          showToast('声音未能开启，请使用打包后的离线成品重试');
        }
      }
      document.querySelector('#sound-toggle').addEventListener('click', () => { setSoundEnabled(!soundEnabled); });
      document.querySelector('#master-switch').addEventListener('click', () => { setSoundEnabled(!soundEnabled); });
      document.querySelector('#master-volume').addEventListener('input', event => {
        masterVolume = Number(event.target.value) / 100; updateSoundControls(); updateAudioLevels();
      });
      document.querySelectorAll('[data-layer]').forEach(button => {
        button.addEventListener('click', () => {
          const kind = button.dataset.layer; soundLayers[kind] = !soundLayers[kind];
          updateSoundControls(); updateAudioLevels();
          if (soundEnabled && kind === 'water') ensureAudio().catch(() => {});
        });
      });
      updateSoundControls();

      function cleanupOneShot(record) {
        if (!record || !activeOneShots.has(record)) return;
        activeOneShots.delete(record);
        for (const node of [record.source, record.gain, record.panner]) { try { node.disconnect(); } catch (_) {} }
      }
      function playOneShot(kind, position, level) {
        if (!audioContext || audioContext.state !== 'running' || !audioBuffers[kind] || !soundEnabled || !soundLayers[kind] || document.hidden) return false;
        while (activeOneShots.size >= 8) {
          const oldest = activeOneShots.values().next().value;
          oldest.source.onended = null; try { oldest.source.stop(); } catch (_) {} cleanupOneShot(oldest);
        }
        const source = audioContext.createBufferSource(); const gain = audioContext.createGain();
        const panner = createAudioPanner(position, 14, 0.65); source.buffer = audioBuffers[kind];
        const now = audioContext.currentTime;
        gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(level, now + 0.008);
        source.connect(gain); gain.connect(panner); panner.connect(audioLayerGains[kind]);
        const record = { source, gain, panner, kind, startedAt: now }; activeOneShots.add(record);
        source.onended = () => cleanupOneShot(record); source.start(); return true;
      }
      async function playWindChime() {
        windChimeHitCount += 1; lastWindChimeHitAt = performance.now();
        if (reducedMotion) { showToast('减少动态效果已启用，风铃保持静音'); return; }
        if (!soundEnabled) { showToast('先在右上角开启庭园声音'); return; }
        if (!soundLayers.bell) { showToast('风铃独立开关已关闭'); return; }
        try {
          const ready = await ensureAudio();
          if (!ready || !soundEnabled || !soundLayers.bell) return;
          if (playOneShot('bell', [windChime.position.x, windChime.position.y, windChime.position.z], 0.65)) {
            windChimeSoundCount += 1; lastWindChimeSoundAt = performance.now();
          }
        } catch (error) { console.error(error); }
      }
      async function playPetalAir(tree) {
        if (reducedMotion || !soundEnabled || !soundLayers.petal || document.hidden) return;
        try {
          const ready = await ensureAudio();
          if (!ready || !soundEnabled || !soundLayers.petal) return;
          if (playOneShot('petal', [tree.x, tree.y, tree.z], 0.55)) {
            petalSoundCount += 1; lastPetalSoundAt = performance.now();
          }
        } catch (error) { console.error(error); }
      }
      function updateAudioListener(now) {
        if (!audioContext || !soundEnabled || now - lastAudioListenerUpdate < 100) return;
        lastAudioListenerUpdate = now;
        const listener = audioContext.listener;
        camera.getWorldDirection(audioForward); audioUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
        if (listener.positionX) {
          listener.positionX.value = camera.position.x; listener.positionY.value = camera.position.y; listener.positionZ.value = camera.position.z;
          listener.forwardX.value = audioForward.x; listener.forwardY.value = audioForward.y; listener.forwardZ.value = audioForward.z;
          listener.upX.value = audioUp.x; listener.upY.value = audioUp.y; listener.upZ.value = audioUp.z;
        } else {
          listener.setPosition(camera.position.x, camera.position.y, camera.position.z);
          listener.setOrientation(audioForward.x, audioForward.y, audioForward.z, audioUp.x, audioUp.y, audioUp.z);
        }
      }
      function getAudioState() {
        let analyserRms = 0;
        let analyserPeak = 0;
        if (audioAnalyser && audioContext && audioContext.state === 'running') {
          const samples = new Float32Array(audioAnalyser.fftSize); audioAnalyser.getFloatTimeDomainData(samples);
          let squares = 0;
          for (const value of samples) { squares += value * value; analyserPeak = Math.max(analyserPeak, Math.abs(value)); }
          analyserRms = Math.sqrt(squares / samples.length);
        }
        const waterDistance = Math.hypot(camera.position.x, camera.position.y - 0.35, camera.position.z - 4);
        const waterAttenuationEstimate = waterDistance <= 9 ? 1 : 9 / (9 + 0.85 * (waterDistance - 9));
        return {
          enabled: soundEnabled, reducedMotion, volume: masterVolume, layers: { ...soundLayers },
          contextCreated: !!audioContext, contextState: audioContext ? audioContext.state : 'not-created',
          decoded: Object.fromEntries(Object.entries(audioBuffers).map(([kind, buffer]) => [kind, !!buffer])),
          durations: Object.fromEntries(Object.entries(audioBuffers).map(([kind, buffer]) => [kind, buffer ? buffer.duration : 0])),
          inlineBytesBeforeDecode: { ...audioEncodedBytes }, base64Released: !window.__SAKURA_AUDIO__ || ['water', 'bell', 'petal'].every(kind => !window.__SAKURA_AUDIO__[kind]),
          waterSourceCreated: !!waterSource, waterPlaying: !!waterSource && soundEnabled && soundLayers.water && !!audioContext && audioContext.state === 'running',
          waterPosition: waterPanner ? [waterPanner.positionX.value, waterPanner.positionY.value, waterPanner.positionZ.value] : [0, 0.35, 4],
          listenerPosition: camera.position.toArray(), activeOneShots: activeOneShots.size, oneShotLimit: 8,
          activeOneShotsByKind: Object.fromEntries(['water', 'bell', 'petal'].map(kind => [kind, [...activeOneShots].filter(record => record.kind === kind).length])),
          layerGainValues: Object.fromEntries(['water', 'bell', 'petal'].map(kind => [kind, audioLayerGains[kind] ? audioLayerGains[kind].gain.value : 0])),
          waterDistance, waterAttenuationEstimate, audioVisibilitySuspendCount, audioVisibilityResumeCount, lastAudioVisibilityState,
          windChimeHitCount, windChimeSoundCount, petalSoundCount, lastWindChimeHitAt, lastWindChimeSoundAt, lastPetalSoundAt,
          masterGain: audioMaster ? audioMaster.gain.value : 0, analyserRms, analyserPeak,
          limiter: audioLimiter ? { threshold: audioLimiter.threshold.value, ratio: audioLimiter.ratio.value, reduction: audioLimiter.reduction } : null,
        };
      }
      window.__SAKURA_AUDIO_STATE__ = getAudioState;
      document.addEventListener('visibilitychange', () => {
        lastAudioVisibilityState = document.visibilityState;
        if (!audioContext) return;
        if (document.hidden) {
          updateAudioLevels();
          window.setTimeout(() => {
            if (document.hidden && audioContext && audioContext.state === 'running') {
              audioContext.suspend().then(() => { audioVisibilitySuspendCount += 1; }).catch(() => {});
            }
          }, 70);
        } else if (soundEnabled) {
          audioContext.resume().then(() => { audioVisibilityResumeCount += 1; updateAudioLevels(); }).catch(() => {});
        }
      });

      window.__SAKURA_WIND_CHIME_POINT__ = () => {
        const point = new THREE.Vector3();
        windChimeHitTarget.getWorldPosition(point);
        point.project(camera);
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + (point.x * 0.5 + 0.5) * rect.width,
          y: rect.top + (-point.y * 0.5 + 0.5) * rect.height,
        };
      };

      // ===== Five-sided square glass cover, seated on the 18 m display base =====
      const coverWidth = 17.72;
      const coverDepth = 17.72;
      const coverHeight = 8.35;
      const coverBottom = 0.026;
      const coverGeometry = new THREE.BoxGeometry(coverWidth, coverHeight, coverDepth);
      coverGeometry.groups = coverGeometry.groups.filter((group, index) => index !== 3);
      const coverMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xf0f5f2, roughness: 0.07, metalness: 0,
        transmission: 0.20, thickness: 0.018, ior: 1.45,
        transparent: true, opacity: 0.055, side: THREE.FrontSide,
        depthWrite: false, envMapIntensity: 0.12,
      });
      const glassCover = new THREE.Mesh(coverGeometry, coverMaterial);
      glassCover.position.y = coverBottom + coverHeight / 2;
      glassCover.renderOrder = 12;
      scene.add(glassCover);
      const coverEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(coverWidth, coverHeight, coverDepth)),
        new THREE.LineBasicMaterial({ color: 0x9db3ad, transparent: true, opacity: 0.30, depthWrite: false }),
      );
      coverEdges.position.copy(glassCover.position);
      scene.add(coverEdges);
      const glassBaseTargets = [];
      const baseHitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
      for (const [width, depth, x, z] of [
        [18.00, 0.28, 0, 8.86], [18.00, 0.28, 0, -8.86],
        [0.28, 17.72, 8.86, 0], [0.28, 17.72, -8.86, 0],
      ]) {
        const target = new THREE.Mesh(new THREE.BoxGeometry(width, 0.68, depth), baseHitMaterial);
        target.position.set(x, 0.34, z);
        target.userData.kind = 'glass-base';
        scene.add(target);
        glassBaseTargets.push(target);
      }
      const glassButton = document.querySelector('#glass-view');
      function setGlassCoverVisible(visible, notify = true) {
        glassCover.visible = visible;
        coverEdges.visible = visible;
        glassButton.setAttribute('aria-pressed', String(visible));
        document.querySelector('#glass-label').textContent = visible ? '玻璃·开' : '玻璃·关';
        document.querySelector('#guide-glass-state').textContent = visible ? '显示' : '收起';
        if (notify) showToast(visible ? '方形玻璃罩已显示' : '玻璃罩已隐藏');
      }
      function toggleGlassCover() {
        setGlassCoverVisible(!glassCover.visible);
      }
      glassButton.addEventListener('click', toggleGlassCover);
      setGlassCoverVisible(true, false);

      // ===== Petals above and on the stream =====
      let randomSeed = 0x53a9f17;
      function random() {
        randomSeed |= 0;
        randomSeed = randomSeed + 0x6D2B79F5 | 0;
        let value = Math.imul(randomSeed ^ randomSeed >>> 15, 1 | randomSeed);
        value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
      }
      function createPetalGeometry() {
        const shape = new THREE.Shape();
        shape.moveTo(0, -0.055);
        shape.bezierCurveTo(-0.035, -0.043, -0.052, -0.006, -0.047, 0.030);
        shape.bezierCurveTo(-0.044, 0.052, -0.026, 0.066, -0.013, 0.061);
        shape.quadraticCurveTo(0, 0.046, 0.013, 0.061);
        shape.bezierCurveTo(0.026, 0.066, 0.044, 0.052, 0.047, 0.030);
        shape.bezierCurveTo(0.052, -0.006, 0.035, -0.043, 0, -0.055);
        let outline = shape.getPoints(36);
        if (outline.length > 2 && outline[0].distanceTo(outline[outline.length - 1]) < 0.000001) outline.pop();
        if (THREE.ShapeUtils.isClockWise(outline)) outline = outline.reverse();
        const positions = [0, 0.002, 0.004];
        const uvs = [0.5, 0.52];
        const colors = [1.0, 0.95, 0.97];
        for (const point of outline) {
          const curl = 0.004 * Math.sin((point.y + 0.055) / 0.121 * Math.PI)
            + 0.010 * Math.pow(point.x / 0.052, 2);
          positions.push(point.x, point.y, curl);
          uvs.push(point.x / 0.11 + 0.5, (point.y + 0.055) / 0.121);
          const tip = THREE.MathUtils.clamp((point.y + 0.055) / 0.121, 0, 1);
          colors.push(1.0, 0.90 + tip * 0.07, 0.93 + tip * 0.04);
        }
        const indices = [];
        for (let index = 0; index < outline.length; index++) {
          indices.push(0, index + 1, (index + 1) % outline.length + 1);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        return geometry;
      }
      const petalGeometry = createPetalGeometry();
      const petalMaterial = new THREE.MeshStandardMaterial({
        color: 0xf0cbd3, roughness: 0.82, side: THREE.DoubleSide, vertexColors: true,
        transparent: true, opacity: 0.93, depthWrite: false,
      });
      const fallingCount = mobile ? 96 : 288;
      const fallingPetals = new THREE.InstancedMesh(petalGeometry, petalMaterial, fallingCount);
      fallingPetals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      fallingPetals.frustumCulled = false;
      fallingPetals.visible = !reducedMotion;
      scene.add(fallingPetals);
      const treeZones = treeEmitters.map(tree => ({ x: tree.x, z: tree.z, radius: tree.radius * 0.88, top: tree.height + 0.85 }));
      const fallingState = Array.from({ length: fallingCount }, () => ({}));
      function terrainHeightAt(x, z) {
        const blenderY = -z;
        const center = -4.0 + 0.65 * Math.sin(x * 0.55) + 0.20 * Math.sin(x * 1.15);
        const half = (1.55 + 0.22 * Math.sin(x * 0.75 + 0.8)) / 2;
        const base = 0.44 + 0.035 * Math.sin(x * 1.1) * Math.cos(blenderY * 0.9) + 0.02 * Math.sin(x * 2.7 + blenderY);
        const distance = Math.abs(blenderY - center);
        if (distance < half + 0.38) {
          const t = THREE.MathUtils.clamp((half + 0.38 - distance) / 0.38, 0, 1);
          if (distance < half) return Math.min(base, 0.03 + 0.04 * Math.pow(distance / Math.max(half, 0.01), 2));
          return base * (1 - t) + 0.16 * t;
        }
        return base;
      }
      function resetFalling(petal, initial = false) {
        const zone = treeZones[Math.floor(random() * treeZones.length)];
        const angle = random() * Math.PI * 2;
        const radial = Math.sqrt(random()) * zone.radius;
        petal.x = zone.x + Math.cos(angle) * radial;
        petal.z = zone.z + Math.sin(angle) * radial;
        petal.y = initial ? 0.7 + random() * zone.top : zone.top + random() * 1.3;
        petal.speed = 0.16 + random() * 0.18;
        petal.phase = random() * Math.PI * 2;
        petal.spin = 0.35 + random() * 0.75;
        petal.scale = 0.55 + random() * 0.48;
      }
      fallingState.forEach(petal => resetFalling(petal, true));
      const instanceHelper = new THREE.Object3D();
      function updateFallingPetals(delta, elapsed) {
        if (!fallingPetals.visible) return;
        for (let index = 0; index < fallingState.length; index++) {
          const petal = fallingState[index];
          petal.y -= petal.speed * delta;
          petal.x += (0.072 + Math.sin(elapsed * 0.46 + petal.phase) * 0.060) * delta;
          petal.z += (-0.026 + Math.cos(elapsed * 0.38 + petal.phase) * 0.045) * delta;
          const ground = petalContactHeight(petal.x, petal.z, elapsed);
          if (petal.y < ground + 0.018) resetFalling(petal);
          const groundFade = THREE.MathUtils.clamp((petal.y - ground) / 0.34, 0, 1);
          instanceHelper.position.set(petal.x, petal.y, petal.z);
          instanceHelper.rotation.set(
            elapsed * petal.spin + petal.phase,
            petal.phase + elapsed * petal.spin * 0.63,
            Math.sin(elapsed * 0.7 + petal.phase) * 0.8,
          );
          instanceHelper.scale.setScalar(petal.scale * groundFade);
          instanceHelper.updateMatrix();
          fallingPetals.setMatrixAt(index, instanceHelper.matrix);
        }
        fallingPetals.instanceMatrix.needsUpdate = true;
      }

      const maxBurstPetals = mobile ? 240 : 520;
      const burstMaterial = petalMaterial.clone();
      burstMaterial.color.set(0xffffff);
      const burstPetals = new THREE.InstancedMesh(petalGeometry, burstMaterial, maxBurstPetals);
      burstPetals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      burstPetals.frustumCulled = false;
      burstPetals.count = 0;
      scene.add(burstPetals);
      let burstState = [];
      const burstPalette = [0xf4c4d1, 0xefb3c5, 0xf8dce2, 0xeaa3ba].map(color => new THREE.Color(color));
      function spawnPetalBurst(treeIndex) {
        const tree = treeEmitters[treeIndex];
        if (!tree) return;
        if (reducedMotion) {
          showToast(`${tree.name} · 减少动态效果已开启`);
          return;
        }
        burstState = [];
        const count = Math.min(maxBurstPetals, Math.round(tree.burst * (mobile ? 0.55 : 1)));
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward).normalize();
        for (let index = 0; index < count; index++) {
          const angle = random() * Math.PI * 2;
          const radial = Math.sqrt(random()) * tree.radius * 0.76;
          const foreground = index % 3 === 0;
          let x;
          let y;
          let z;
          let vx;
          let vy;
          let vz;
          let scale;
          if (foreground) {
            const origin = camera.position.clone()
              .addScaledVector(forward, 6 + random() * 7)
              .addScaledVector(right, (random() - 0.5) * 8)
              .addScaledVector(up, (random() - 0.35) * 5.5);
            const velocity = right.clone().multiplyScalar((random() - 0.5) * 1.4)
              .addScaledVector(up, -0.25 - random() * 0.55)
              .addScaledVector(forward, 0.15 + random() * 0.25);
            x = origin.x; y = origin.y; z = origin.z;
            vx = velocity.x; vy = velocity.y; vz = velocity.z;
            scale = 1.15 + random() * 2.0;
          } else {
            x = tree.x + Math.cos(angle) * radial;
            y = tree.y + (random() - 0.5) * tree.radius * 0.58;
            z = tree.z + Math.sin(angle) * radial;
            vx = Math.cos(angle) * (0.42 + random() * 0.95);
            vy = 0.16 + random() * 0.72;
            vz = Math.sin(angle) * (0.42 + random() * 0.95);
            scale = 2.0 + random() * 2.4;
          }
          burstState.push({
            x, y, z, vx, vy, vz, foreground, settled: false,
            age: 0, life: 4.6 + random() * 3.4,
            scale,
            phase: random() * Math.PI * 2,
            spin: 0.7 + random() * 1.8,
          });
          burstPetals.setColorAt(index, burstPalette[Math.floor(random() * burstPalette.length)]);
        }
        burstPetals.count = count;
        if (burstPetals.instanceColor) burstPetals.instanceColor.needsUpdate = true;
        showToast(`${tree.name} · ${count} 片花瓣随风散开`);
      }
      function updatePetalBursts(delta, elapsed) {
        for (let index = burstState.length - 1; index >= 0; index--) {
          const petal = burstState[index];
          petal.age += delta;
          if (petal.age >= petal.life) {
            burstState.splice(index, 1);
            continue;
          }
          if (!petal.settled) {
            petal.vy -= 0.28 * delta;
            petal.x += (petal.vx + 0.065 + Math.sin(elapsed * 0.8 + petal.phase) * 0.15) * delta;
            petal.y += petal.vy * delta;
            petal.z += (petal.vz - 0.022 + Math.cos(elapsed * 0.7 + petal.phase) * 0.12) * delta;
            if (!petal.foreground) {
              const ground = petalContactHeight(petal.x, petal.z, elapsed);
              if (petal.y <= ground + 0.012) {
                petal.y = ground + 0.012;
                petal.settled = true;
                petal.onWater = isWaterContact(petal.x, petal.z);
                petal.waterOffset = petal.z - riverCenter(petal.x);
                petal.vx = petal.vy = petal.vz = 0;
              }
            }
          } else if (petal.onWater) {
            if (!reducedMotion) petal.x += 0.035 * delta;
            if (petal.x > 8.35) petal.x = -8.35;
            petal.z = riverCenter(petal.x) + petal.waterOffset;
            petal.y = waterSurfaceHeight(petal.x, petal.z, reducedMotion ? 0 : elapsed) + 0.003;
          }
          const fadeScale = Math.max(0, Math.min(1, (petal.life - petal.age) / 1.1));
          instanceHelper.position.set(petal.x, petal.y, petal.z);
          if (petal.settled) instanceHelper.rotation.set(-Math.PI / 2, 0, petal.phase);
          else instanceHelper.rotation.set(elapsed * petal.spin + petal.phase, petal.phase + elapsed * 0.7, Math.sin(elapsed + petal.phase));
          instanceHelper.scale.setScalar(petal.scale * fadeScale);
          instanceHelper.updateMatrix();
          burstPetals.setMatrixAt(index, instanceHelper.matrix);
        }
        burstPetals.count = burstState.length;
        burstPetals.instanceMatrix.needsUpdate = true;
      }

      const waterPetalCount = mobile ? 24 : 42;
      const waterPetalMaterial = petalMaterial.clone();
      waterPetalMaterial.color.set(0xf3d7da);
      waterPetalMaterial.opacity = 0.82;
      const waterPetals = new THREE.InstancedMesh(petalGeometry, waterPetalMaterial, waterPetalCount);
      waterPetals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      waterPetals.frustumCulled = false;
      scene.add(waterPetals);
      const waterPetalState = Array.from({ length: waterPetalCount }, () => ({
        x: -8.2 + random() * 16.4,
        offset: (random() - 0.5) * 0.68,
        speed: 0.07 + random() * 0.09,
        angle: random() * Math.PI * 2,
        scale: 0.62 + random() * 0.48,
        phase: random() * Math.PI * 2,
      }));
      function updateWaterPetals(delta, elapsed) {
        for (let index = 0; index < waterPetalState.length; index++) {
          const petal = waterPetalState[index];
          if (!reducedMotion) petal.x += petal.speed * delta;
          if (petal.x > 8.35) petal.x = -8.35;
          const z = riverCenter(petal.x) + petal.offset;
          instanceHelper.position.set(
            petal.x,
            waterSurfaceHeight(petal.x, z, reducedMotion ? 0 : elapsed) + 0.002,
            z,
          );
          instanceHelper.rotation.set(-Math.PI / 2, 0, petal.angle + (reducedMotion ? 0 : elapsed * 0.025));
          instanceHelper.scale.setScalar(petal.scale);
          instanceHelper.updateMatrix();
          waterPetals.setMatrixAt(index, instanceHelper.matrix);
        }
        waterPetals.instanceMatrix.needsUpdate = true;
      }

      // ===== Subtle tea steam =====
      const steamCanvas = document.createElement('canvas');
      steamCanvas.width = steamCanvas.height = 64;
      const steamContext = steamCanvas.getContext('2d');
      const steamGradient = steamContext.createRadialGradient(32, 32, 2, 32, 32, 31);
      steamGradient.addColorStop(0, 'rgba(255,255,255,0.7)');
      steamGradient.addColorStop(0.45, 'rgba(255,255,255,0.22)');
      steamGradient.addColorStop(1, 'rgba(255,255,255,0)');
      steamContext.fillStyle = steamGradient;
      steamContext.fillRect(0, 0, 64, 64);
      const steamTexture = new THREE.CanvasTexture(steamCanvas);
      const steamSprites = [];
      const cupPositions = [new THREE.Vector3(0.68, 1.60, 0.09), new THREE.Vector3(0.92, 1.60, 0.09)];
      for (const cup of cupPositions) {
        for (let index = 0; index < 8; index++) {
          const material = new THREE.SpriteMaterial({
            map: steamTexture, color: 0xf5f1e8, transparent: true, opacity: 0, depthWrite: false,
          });
          const sprite = new THREE.Sprite(material);
          sprite.visible = !reducedMotion;
          scene.add(sprite);
          steamSprites.push({ sprite, cup, phase: index / 8 + random() * 0.06, sway: random() * Math.PI * 2 });
        }
      }
      function updateSteam(elapsed) {
        if (reducedMotion) return;
        for (const steam of steamSprites) {
          const life = (elapsed * 0.12 + steam.phase) % 1;
          steam.sprite.position.set(
            steam.cup.x + Math.sin(life * 5 + steam.sway) * 0.045,
            steam.cup.y + life * 0.62,
            steam.cup.z + Math.cos(life * 4 + steam.sway) * 0.025,
          );
          const scale = 0.07 + life * 0.20;
          steam.sprite.scale.set(scale, scale * 1.35, 1);
          steam.sprite.material.opacity = Math.sin(life * Math.PI) * 0.095;
        }
      }

      function updateEnvironment(delta, elapsed) {
        const doorBlend = reducedMotion ? 1 : 1 - Math.exp(-delta * 5.2);
        for (const door of doors) {
          const target = door.userData.targetX;
          door.position.x += (target - door.position.x) * doorBlend;
        }
        koiTimeUniform.value = reducedMotion ? 0 : elapsed;
        gardenTimeUniform.value = reducedMotion ? 0 : elapsed;
        if (!reducedMotion) {
          for (const koi of fish) {
            const swimPhase = elapsed * koi.speed + koi.phase;
            const x = koi.base.x + Math.sin(swimPhase) * 1.05;
            const direction = Math.cos(swimPhase) >= 0 ? 0 : Math.PI;
            const targetHeading = koi.baseRotationY + direction;
            const headingDelta = Math.atan2(Math.sin(targetHeading - koi.object.rotation.y), Math.cos(targetHeading - koi.object.rotation.y));
            koi.object.rotation.y += headingDelta * (1 - Math.exp(-delta * 2.4));
            koi.object.position.set(
              x,
              koi.base.y + Math.sin(elapsed * 0.72 + koi.phase) * 0.008,
              riverCenter(x) + koi.offsetZ + Math.sin(elapsed * 0.36 + koi.phase) * 0.075,
            );
          }
          for (const ribbon of ribbons) {
            ribbon.object.rotation.z = ribbon.base.z + Math.sin(elapsed * 0.82 + ribbon.phase) * 0.026;
            ribbon.object.rotation.x = ribbon.base.x + Math.sin(elapsed * 0.57 + ribbon.phase) * 0.012;
          }
          windChime.rotation.z = Math.sin(elapsed * 1.08) * 0.055;
          windChime.rotation.x = Math.sin(elapsed * 0.83 + 0.8) * 0.035;
          strip.rotation.y = Math.sin(elapsed * 1.35) * 0.22;
        }
        updateFallingPetals(delta, elapsed);
        updatePetalBursts(delta, elapsed);
        updateWaterPetals(delta, elapsed);
        updateSteam(elapsed);
        updateRipples(delta);
      }

      // ===== Continuous time-of-day lighting =====
      const timePresets = [
        {
          hour: 7,
          background: new THREE.Color(0xdde2dd), sky: new THREE.Color(0xdce8ef), ground: new THREE.Color(0x6d715c),
          keyColor: new THREE.Color(0xffe2bc), rimColor: new THREE.Color(0xffd7d0),
          waterColor: new THREE.Color(0x8bbdb8), floorColor: new THREE.Color(0xadb5ac),
          keyPosition: new THREE.Vector3(-8, 15, 10), rimPosition: new THREE.Vector3(1, 13, -8),
          hemiIntensity: 0.78, keyIntensity: 1.65, rimIntensity: 0.62, interiorIntensity: 14,
          environment: 0.34, exposure: 0.90, paperGlow: 0, lampGlow: 0.12,
          gardenGlow: 0, gardenLight: 0, crownLight: 0,
        },
        {
          hour: 12,
          background: new THREE.Color(0xe4e7df), sky: new THREE.Color(0xd8e8f3), ground: new THREE.Color(0x68745c),
          keyColor: new THREE.Color(0xfff1d6), rimColor: new THREE.Color(0xe8f0ff),
          waterColor: new THREE.Color(0x79b7b4), floorColor: new THREE.Color(0xb8bdb0),
          keyPosition: new THREE.Vector3(-3, 19, 4), rimPosition: new THREE.Vector3(8, 13, -7),
          hemiIntensity: 1.02, keyIntensity: 2.80, rimIntensity: 0.78, interiorIntensity: 12,
          environment: 0.50, exposure: 0.96, paperGlow: 0, lampGlow: 0.05,
          gardenGlow: 0, gardenLight: 0, crownLight: 0,
        },
        {
          hour: 18,
          background: new THREE.Color(0xb8aaa3), sky: new THREE.Color(0xb7b3ca), ground: new THREE.Color(0x655b55),
          keyColor: new THREE.Color(0xffb067), rimColor: new THREE.Color(0x9da7cf),
          waterColor: new THREE.Color(0x87a9aa), floorColor: new THREE.Color(0xa89e96),
          keyPosition: new THREE.Vector3(-14, 6, 8), rimPosition: new THREE.Vector3(5, 10, -6),
          hemiIntensity: 0.62, keyIntensity: 2.05, rimIntensity: 0.72, interiorIntensity: 26,
          environment: 0.32, exposure: 0.98, paperGlow: 0.12, lampGlow: 0.55,
          gardenGlow: 0.18, gardenLight: 5, crownLight: 7,
        },
        {
          hour: 22,
          background: new THREE.Color(0x17252f), sky: new THREE.Color(0x8094b3), ground: new THREE.Color(0x1a2428),
          keyColor: new THREE.Color(0xb8c9e8), rimColor: new THREE.Color(0xffc58b),
          waterColor: new THREE.Color(0x294c56), floorColor: new THREE.Color(0x27343a),
          keyPosition: new THREE.Vector3(4, 14, -6), rimPosition: new THREE.Vector3(-3, 8, 5),
          hemiIntensity: 0.30, keyIntensity: 0.55, rimIntensity: 0.34, interiorIntensity: 34,
          environment: 0.15, exposure: 0.88, paperGlow: 0.24, lampGlow: 0.72,
          gardenGlow: 0.48, gardenLight: 10, crownLight: 24,
        },
      ];
      const timeMix = {
        background: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color(),
        keyColor: new THREE.Color(), rimColor: new THREE.Color(), waterColor: new THREE.Color(), floorColor: new THREE.Color(),
        keyPosition: new THREE.Vector3(), rimPosition: new THREE.Vector3(),
        hemiIntensity: 0, keyIntensity: 0, rimIntensity: 0, interiorIntensity: 0,
        environment: 0, exposure: 1, paperGlow: 0, lampGlow: 0, gardenGlow: 0, gardenLight: 0, crownLight: 0,
      };
      const timeColorKeys = ['background', 'sky', 'ground', 'keyColor', 'rimColor', 'waterColor', 'floorColor'];
      const timeNumberKeys = [
        'hemiIntensity', 'keyIntensity', 'rimIntensity', 'interiorIntensity', 'environment', 'exposure',
        'paperGlow', 'lampGlow', 'gardenGlow', 'gardenLight', 'crownLight',
      ];
      function sampleTime(hour) {
        let start = timePresets[0];
        let end = timePresets[timePresets.length - 1];
        for (let index = 0; index < timePresets.length - 1; index++) {
          if (hour <= timePresets[index + 1].hour) {
            start = timePresets[index];
            end = timePresets[index + 1];
            break;
          }
        }
        const raw = THREE.MathUtils.clamp((hour - start.hour) / (end.hour - start.hour), 0, 1);
        const blend = raw * raw * (3 - 2 * raw);
        for (const key of timeColorKeys) timeMix[key].lerpColors(start[key], end[key], blend);
        timeMix.keyPosition.lerpVectors(start.keyPosition, end.keyPosition, blend);
        timeMix.rimPosition.lerpVectors(start.rimPosition, end.rimPosition, blend);
        for (const key of timeNumberKeys) timeMix[key] = THREE.MathUtils.lerp(start[key], end[key], blend);
      }
      let nightInterface = null;
      function applyTime(hour) {
        sampleTime(hour);
        scene.background.copy(timeMix.background);
        hemisphere.color.copy(timeMix.sky);
        hemisphere.groundColor.copy(timeMix.ground);
        hemisphere.intensity = timeMix.hemiIntensity;
        key.color.copy(timeMix.keyColor);
        key.position.copy(timeMix.keyPosition);
        key.intensity = timeMix.keyIntensity;
        rim.color.copy(timeMix.rimColor);
        rim.position.copy(timeMix.rimPosition);
        rim.intensity = timeMix.rimIntensity;
        interior.intensity = timeMix.interiorIntensity;
        scene.environmentIntensity = timeMix.environment;
        renderer.toneMappingExposure = timeMix.exposure;
        floor.material.color.copy(timeMix.floorColor);
        for (const material of waterMaterials) material.color.copy(timeMix.waterColor);
        const backdropBrightness = hour <= 18
          ? THREE.MathUtils.lerp(1, 0.86, (hour - 7) / 11)
          : THREE.MathUtils.lerp(0.86, 0.44, (hour - 18) / 4);
        for (const entry of backdropColors) entry.material.color.copy(entry.dayColor).multiplyScalar(backdropBrightness);
        for (const material of paperMaterials) {
          material.emissive.set(0xffb66f);
          material.emissiveIntensity = timeMix.paperGlow;
        }
        for (const material of lampMaterials) {
          material.emissive.set(0xff9f46);
          material.emissiveIntensity = timeMix.lampGlow;
        }
        for (const material of gardenGlowMaterials) material.emissiveIntensity = timeMix.gardenGlow;
        for (const light of gardenLights) light.intensity = timeMix.gardenLight;
        for (const light of crownLights) light.intensity = timeMix.crownLight;
        for (const lantern of hangingLanterns) {
          lantern.light.intensity = timeMix.gardenLight * 0.32;
          lantern.paper.emissiveIntensity = 0.04 + timeMix.gardenGlow * 0.78;
        }
        const night = hour >= 19.4;
        if (night !== nightInterface) {
          document.body.classList.toggle('night', night);
          nightInterface = night;
        }
      }
      let currentHour = 7;
      let targetHour = 7;
      const timeRange = document.querySelector('#time-range');
      const timeReadout = document.querySelector('#time-readout');
      const timeButtons = [...document.querySelectorAll('.time-button')];
      function formatHour(hour) {
        const totalMinutes = Math.round(hour * 60);
        return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
      }
      function updateTimeControls() {
        timeRange.value = targetHour.toFixed(2);
        timeReadout.textContent = formatHour(targetHour);
        for (const button of timeButtons) {
          button.setAttribute('aria-pressed', String(Math.abs(targetHour - Number(button.dataset.hour)) < 0.001));
        }
      }
      function setTargetHour(hour, immediate = false) {
        targetHour = THREE.MathUtils.clamp(Number(hour), 7, 22);
        if (immediate || reducedMotion) {
          currentHour = targetHour;
          applyTime(currentHour);
        }
        updateTimeControls();
      }
      function updateTime(delta) {
        if (Math.abs(targetHour - currentHour) > 0.001) {
          currentHour += (targetHour - currentHour) * (1 - Math.exp(-delta * 3.2));
          if (Math.abs(targetHour - currentHour) < 0.006) currentHour = targetHour;
        }
        applyTime(currentHour);
      }
      for (const button of timeButtons) {
        button.addEventListener('click', () => setTargetHour(Number(button.dataset.hour)));
      }
      timeRange.addEventListener('input', event => setTargetHour(Number(event.target.value), true));
      setTargetHour(7, true);
      window.__SAKURA_SET_HOUR__ = hour => setTargetHour(hour, true);
      window.__SAKURA_TOGGLE_DOORS__ = toggleDoors;
      window.__SAKURA_SET_DOOR_STATE__ = state => setDoorState(state, true);
      window.__SAKURA_ENTER_ROOM__ = enterRoom;
      window.__SAKURA_EXIT_ROOM__ = exitRoom;
      window.__SAKURA_TOGGLE_GLASS__ = toggleGlassCover;
      window.__SAKURA_BURST_TREE__ = spawnPetalBurst;
      window.__SAKURA_PROJECT_POINT__ = (x, y, z) => {
        const projected = new THREE.Vector3(x, y, z).project(camera);
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + (projected.x + 1) * 0.5 * rect.width,
          y: rect.top + (1 - projected.y) * 0.5 * rect.height,
          ndc: projected.toArray(),
        };
      };

      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      loadingBar.style.width = '100%';
      loadingState.textContent = '整理光照与镜头';
      renderer.compile(scene, camera);

      const qualityPresets = {
        high: { dpr: 2.0, shadow: 4096 },
        balanced: { dpr: 1.35, shadow: 1024 },
        saver: { dpr: 1.0, shadow: 512 },
      };
      const qualityButtons = [...document.querySelectorAll('[data-quality]')];
      const fpsButtons = [...document.querySelectorAll('[data-fps]')];
      const fpsReadout = document.querySelector('#fps-readout');
      const dprReadout = document.querySelector('#dpr-readout');
      const requestedQuality = new URLSearchParams(location.search).get('quality');
      let qualityMode = ['auto', 'high', 'balanced', 'saver'].includes(requestedQuality) ? requestedQuality : 'auto';
      let effectiveQuality = qualityMode === 'auto' ? 'high' : qualityMode;
      let lowFpsWindows = 0;
      let highFpsWindows = 0;
      let lastQualityChange = performance.now();
      function updateQualityControls() {
        for (const button of qualityButtons) button.setAttribute('aria-pressed', String(button.dataset.quality === qualityMode));
        dprReadout.textContent = `DPR ${renderer.getPixelRatio().toFixed(2)}`;
        diagnosticsPanel.dataset.qualityMode = qualityMode;
        diagnosticsPanel.dataset.effectiveQuality = effectiveQuality;
        diagnosticsPanel.dataset.shadowSize = String(key.shadow.mapSize.x);
      }
      function applyQuality(name) {
        if (!qualityPresets[name]) return;
        effectiveQuality = name;
        const preset = qualityPresets[name];
        const nextPixelRatio = mobile
          ? Math.min(devicePixelRatio, 1.35)
          : (qualityMode === 'high' && name === 'high' ? 2 : Math.min(devicePixelRatio, preset.dpr));
        if (Math.abs(renderer.getPixelRatio() - nextPixelRatio) > 0.001) {
          renderer.setPixelRatio(nextPixelRatio);
          renderer.setSize(innerWidth, innerHeight, false);
        }
        const nextShadowSize = mobile ? 2048 : preset.shadow;
        if (key.shadow.mapSize.x !== nextShadowSize) {
          key.shadow.mapSize.set(nextShadowSize, nextShadowSize);
          if (key.shadow.map) {
            key.shadow.map.dispose();
            key.shadow.map = null;
          }
          renderer.shadowMap.needsUpdate = true;
        }
        lowFpsWindows = 0;
        highFpsWindows = 0;
        lastQualityChange = performance.now();
        updateQualityControls();
      }
      function setQualityMode(mode) {
        if (mode !== 'auto' && !qualityPresets[mode]) return;
        qualityMode = mode;
        applyQuality(mode === 'auto' ? effectiveQuality : mode);
      }
      function updateAutoQuality(now) {
        if (mobile || qualityMode !== 'auto' || measuredFps <= 0) return;
        const downgradeThreshold = effectiveQuality === 'high' ? 52 : 45;
        if (measuredFps < downgradeThreshold) {
          lowFpsWindows++;
          highFpsWindows = 0;
        } else if (measuredFps > 58) {
          highFpsWindows++;
          lowFpsWindows = 0;
        } else {
          lowFpsWindows = 0;
          highFpsWindows = 0;
        }
        const dwell = now - lastQualityChange;
        if (lowFpsWindows >= 3 && dwell > 4000) {
          if (effectiveQuality === 'high') applyQuality('balanced');
          else if (effectiveQuality === 'balanced') applyQuality('saver');
        } else if (highFpsWindows >= 20 && dwell > 30000) {
          if (effectiveQuality === 'saver') applyQuality('balanced');
          else if (effectiveQuality === 'balanced') applyQuality('high');
        }
      }
      function updateFrameControls() {
        diagnosticsPanel.dataset.frameLimit = String(frameLimit);
        document.querySelector('#guide-fps-state').textContent = `${frameLimit || '不限'} FPS`;
        for (const button of fpsButtons) button.setAttribute('aria-pressed', String(Number(button.dataset.fps) === frameLimit));
      }
      function setFrameLimit(value) {
        if (![0, 30, 60].includes(value)) return;
        frameLimit = value;
        frameInterval = frameLimit > 0 ? 1000 / frameLimit : 0;
        lastRenderTime = -Infinity;
        frames = 0;
        measuredFps = 0;
        fpsStarted = performance.now();
        lowFpsWindows = 0;
        highFpsWindows = 0;
        lastQualityChange = fpsStarted;
        updateFrameControls();
      }
      for (const button of qualityButtons) button.addEventListener('click', () => setQualityMode(button.dataset.quality));
      for (const button of fpsButtons) button.addEventListener('click', () => setFrameLimit(Number(button.dataset.fps)));
      applyQuality(effectiveQuality);

      let ready = false;
      let frames = 0;
      let fpsStarted = performance.now();
      let measuredFps = 0;
      let animationId = 0;
      const requestedFrameLimit = new URLSearchParams(location.search).get('fps');
      let frameLimit = ['0', '30', '60'].includes(requestedFrameLimit) ? Number(requestedFrameLimit) : (mobile ? 0 : 60);
      let frameInterval = frameLimit > 0 ? 1000 / frameLimit : 0;
      let lastRenderTime = -Infinity;
      setFrameLimit(frameLimit);
      const clock = new THREE.Clock();
      function render() {
        const now = performance.now();
        if (frameInterval > 0 && now - lastRenderTime < frameInterval - 0.5) {
          animationId = requestAnimationFrame(render);
          return;
        }
        lastRenderTime = now;
        const delta = Math.min(clock.getDelta(), 0.05);
        const elapsed = clock.elapsedTime;
        waterTimeUniform.value = reducedMotion ? 0 : elapsed;
        updateCameraTween(now);
        if (!cameraTween) controls.update(delta);
        updateAudioListener(now);
        updateTime(delta);
        updateEnvironment(delta, elapsed);
        renderer.render(scene, camera);
        frames++;
        if (now - fpsStarted >= 1500) {
          measuredFps = frames * 1000 / (now - fpsStarted);
          frames = 0;
          fpsStarted = now;
          diagnosticsPanel.textContent = `FPS ${measuredFps.toFixed(1)}\n网格 ${meshCount}\n三角形 ${Math.round(sourceTriangles).toLocaleString()}\nDraw ${renderer.info.render.calls}\n材质 ${materialSet.size}`;
          Object.assign(diagnosticsPanel.dataset, {
            doorState,
            roomMode: String(roomMode),
            glassVisible: String(glassCover.visible),
            rippleCount: String(ripples.length),
            burstPetals: String(burstState.length),
            doorsOpen: String(doorsOpen),
            fixturesAnchored: String(
              hangingLanterns.every(({ group }) => group.position.y === 3.63 && group.position.z === 0.15)
              && windChime.position.y === 3.63 && windChime.position.z === 0.15
            ),
            groundLanternTexture: String(Boolean(lanternStone.map)),
            groundLanternRoof: 'closed_hip_flat_shaded',
          });
          fpsReadout.textContent = `${measuredFps.toFixed(1)} FPS`;
          updateAutoQuality(now);
        }
        if (!ready) {
          ready = true;
          loading.classList.add('done');
          window.__SAKURA_READY__ = true;
        }
        window.__SAKURA_DIAGNOSTICS__ = {
          ready,
          fps: measuredFps,
          meshes: meshCount,
          triangles: Math.round(sourceTriangles),
          drawCalls: renderer.info.render.calls,
          materials: materialSet.size,
          qualityMode,
          effectiveQuality,
          pixelRatio: renderer.getPixelRatio(),
          shadowSize: key.shadow.mapSize.x,
          textures: renderer.info.memory.textures,
          geometries: renderer.info.memory.geometries,
          bounds: size.toArray(),
          camera: camera.position.toArray(),
          target: controls.target.toArray(),
          hour: currentHour,
          doorsOpen,
          doorState,
          roomMode,
          glassVisible: glassCover.visible,
          burstPetals: burstState.length,
          rippleCount: ripples.length,
          doorPositions: doors.map(door => ({ name: door.name, x: Number(door.position.x.toFixed(4)) })),
          cameraTween: Boolean(cameraTween),
          treeTargets: treeHitTargets.length,
          fish: fish.length,
          fishMotion: fish.map(koi => ({ pattern: koi.object.userData.pattern, position: koi.object.position.toArray().map(value => Number(value.toFixed(3))), heading: Number(koi.object.rotation.y.toFixed(3)) })),
          koiSwimTime: Number(koiTimeUniform.value.toFixed(3)),
          ribbons: ribbons.length,
          fallingPetals: fallingPetals.visible ? fallingCount : 0,
          waterPetals: waterPetalCount,
          timeLighting: {
            presetHours: timePresets.map(preset => preset.hour),
            hemiIntensity: Number(timeMix.hemiIntensity.toFixed(4)),
            keyIntensity: Number(timeMix.keyIntensity.toFixed(4)),
            rimIntensity: Number(timeMix.rimIntensity.toFixed(4)),
            environment: Number(timeMix.environment.toFixed(4)),
            exposure: Number(timeMix.exposure.toFixed(4)),
          },
          windChime: {
            muted: !soundEnabled || !soundLayers.bell,
            hitCount: windChimeHitCount,
            soundCount: windChimeSoundCount,
            audioState: audioContext ? audioContext.state : 'not-created',
            lastHitAt: lastWindChimeHitAt,
            lastSoundAt: lastWindChimeSoundAt,
            activeBuses: [...activeOneShots].filter(record => record.kind === 'bell').length,
          },
          audio: getAudioState(),
          manualCamera: { activePreset: activeCameraPreset, fov: camera.fov, tweenKind: cameraTween?.kind || null },
          petalAudio: { soundCount: petalSoundCount, lastSoundAt: lastPetalSoundAt },
          pureCapture: { count: pureCaptureCount, ...lastPureCapture, pureMode: document.body.classList.contains('pure') },
          approachPebblesPresent: Boolean(model.getObjectByName('SM_R5_Stage75_Bridge_Approach_Pebbles')),
          stage76: {
            ui: '庭园手帖', cameraPresetCount: Object.keys(cameraPresets).length, automaticTour: false,
            audioEngine: 'inline-real-recordings', soundEnabled, masterVolume, soundLayers: { ...soundLayers },
            oneAudioEngine: true, syntheticWindChime: false,
          },
          stage75: {
            sillPresent: Boolean(model.getObjectByName('SM_R5_Stage75_Shoji_Sill_Real_Grooves')),
            accumulationPresent: Boolean(model.getObjectByName('SM_R5_Stage75_Accumulated_And_Drifting_Petals')),
            gardenMeshes: ['SM_R5_Stage75_Garden_Hosta_Leaves', 'SM_R5_Stage75_Garden_Fern_Pinnae', 'SM_R5_Stage75_Garden_Sedge_Blades', 'SM_R5_Stage75_Garden_Small_Blossoms', 'SM_R5_Stage75_Garden_Flower_Centers'].filter(name => Boolean(model.getObjectByName(name))).length,
            windTime: Number(gardenTimeUniform.value.toFixed(3)),
            petalVertices: petalGeometry.attributes.position.count,
            petalTriangles: petalGeometry.index.count / 3,
            settledBurstPetals: burstState.filter(petal => petal.settled).length,
            settledWaterPetals: burstState.filter(petal => petal.settled && petal.onWater).length,
            waterContact: { dynamicClearance: 0.002, settledClearance: 0.003, rippleClearance: 0.004, porchY: 1.096, followsMeshAndWave: true },
            waterContactSamples: waterPetalState.slice(0, 4).map(petal => {
              const z = riverCenter(petal.x) + petal.offset;
              return { x: petal.x, z, base: waterBaseHeight(petal.x, z), centerY: waterSurfaceHeight(petal.x, z, reducedMotion ? 0 : waterTimeUniform.value) + 0.002 };
            }),
            settledContactSamples: burstState.filter(petal => petal.settled).slice(0, 8).map(petal => ({
              x: petal.x, y: petal.y, z: petal.z, onWater: Boolean(petal.onWater),
              surfaceY: petal.onWater ? waterSurfaceHeight(petal.x, petal.z, reducedMotion ? 0 : waterTimeUniform.value) : (isPorchContact(petal.x, petal.z) ? 1.096 : terrainHeightAt(petal.x, petal.z)),
            })),
            heroHitCenter: treeHitTargets[0].position.toArray(),
            heroHitScale: treeHitTargets[0].scale.toArray(),
          },
          fixtureAnchors: [...hangingLanterns.map(({ group }) => group.position.toArray()), windChime.position.toArray()],
          groundLanternBaseHasTexture: Boolean(lanternStone.map),
          groundLanternRoof: 'closed_hip_flat_shaded',
        };
        animationId = requestAnimationFrame(render);
      }
      function resume() {
        if (!animationId && !document.hidden) {
          clock.getDelta();
          animationId = requestAnimationFrame(render);
        }
      }
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          cancelAnimationFrame(animationId);
          animationId = 0;
        } else resume();
      });
      resume();

      let userMoved = false;
      controls.addEventListener('start', () => { userMoved = true; });
      function resetView() {
        if (cameraTween && cameraTween.kind !== 'manual') return;
        if (cameraTween) cancelCameraTween();
        userMoved = false;
        if (roomMode) startCameraTween(roomPosition, roomTarget, undefined, 52);
        else {
          activeCameraPreset = 'home';
          updateCameraPresetControls();
          startCameraTween(framedHomePosition(), homeTarget, undefined, 35, 'manual');
        }
      }
      document.querySelector('#reset-view').addEventListener('click', resetView);
      document.querySelector('#pure-view').addEventListener('click', () => { closeHandbookPanels(); document.body.classList.add('pure'); });
      document.querySelector('#exit-pure').addEventListener('click', () => document.body.classList.remove('pure'));

      let pureCaptureCount = 0;
      let lastPureCapture = { width: 0, height: 0, status: 'none' };
      function capturePureView() {
        // Render and copy in the same user-gesture task; DOM controls never enter the image.
        renderer.render(scene, camera);
        const sourceCanvas = renderer.domElement;
        const output = document.createElement('canvas');
        output.width = sourceCanvas.width;
        output.height = sourceCanvas.height;
        const context = output.getContext('2d', { alpha: false });
        if (!context) {
          lastPureCapture = { width: output.width, height: output.height, status: '2d-context-unavailable' };
          return;
        }
        context.drawImage(sourceCanvas, 0, 0);
        output.toBlob(blob => {
          if (!blob) {
            lastPureCapture = { width: output.width, height: output.height, status: 'png-encoding-failed' };
            return;
          }
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `桜水日和_纯享_${formatHour(currentHour).replace(':', '')}.png`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          pureCaptureCount++;
          lastPureCapture = { width: output.width, height: output.height, status: 'download-triggered', bytes: blob.size };
        }, 'image/png');
      }
      document.querySelector('#capture-pure').addEventListener('click', capturePureView);
      window.__SAKURA_CAPTURE_PURE__ = capturePureView;
      addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          closeHandbookPanels(true);
          document.body.classList.remove('pure');
          if (roomMode) exitRoom();
        }
        if (event.key.toLowerCase() === 'r') resetView();
      });
      addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight, false);
        if (!userMoved && !roomMode && !cameraTween) {
          camera.position.copy(framedHomePosition());
          controls.target.copy(homeTarget);
          controls.update();
        }
      });
    }

    start().catch(showError);
  