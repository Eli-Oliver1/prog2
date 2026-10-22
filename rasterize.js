const INPUT_TRIANGLES_URL = "https://ncsucgclass.github.io/prog3/triangles.json";
const INPUT_LIGHTS_URL = "https://ncsucgclass.github.io/prog3/lights.json";
const INPUT_ELLIPSOIDS_URL = "https://ncsucgclass.github.io/prog2/ellipsoids.json";

const DEFAULT_EYE = [0.5, 0.5, -0.5];
const DEFAULT_FORWARD = [0, 0, 1];
const DEFAULT_UP = [0, 1, 0];
const DEFAULT_LIGHT = {
  x: -0.5, y: 1.5, z: -0.5,
  ambient: [1, 1, 1], diffuse: [1, 1, 1], specular: [1, 1, 1]
};
const MAX_LIGHTS = 8;
const NEAR_PLANE = 0.5;
const FAR_PLANE = 100.0;
const MOVE_STEP = 0.04;
const ROTATE_STEP = Math.PI / 36.0; // five degrees per key press

let gl = null;
let canvas = null;
let shaderProgram = null;
let attribPosition = -1;
let attribNormal = -1;
let uniformModel = null;
let uniformView = null;
let uniformProjection = null;
let uniformNormalMatrix = null;
let uniformEye = null;
let uniformMatAmbient = null;
let uniformMatDiffuse = null;
let uniformMatSpecular = null;
let uniformShininess = null;
let uniformLightingEnabled = null;
let uniformLightCount = null;
let uniformLightPositions = null;
let uniformLightAmbient = null;
let uniformLightDiffuse = null;
let uniformLightSpecular = null;

let cameraEye = vec3.fromValues(...DEFAULT_EYE);
let cameraForward = vec3.fromValues(...DEFAULT_FORWARD);
let cameraUp = vec3.fromValues(...DEFAULT_UP);
let frustumWindow = { left: -0.5, right: 0.5, bottom: -0.5, top: 0.5 };
let lightingEnabled = true;
let customMode = false;
let selectedIndex = -1;
let triangleModels = [];
let ellipsoidModels = [];
let normalSceneModels = [];
let customSceneModels = [];
let activeSceneModels = [];
let selectableModels = [];
let activeLights = [];
let customLights = [];
let lastError = "";

const DEFAULT_MATERIAL = {
  ambient: [0.1, 0.1, 0.1],
  diffuse: [0.7, 0.7, 0.7],
  specular: [0.25, 0.25, 0.25],
  n: 16
};

async function fetchJSON(url, description) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${description} (${response.status} ${response.statusText}): ${url}`);
  }
  return response.json();
}

function vec3From(value, fallback) {
  if (!Array.isArray(value) || value.length < 3 || !value.slice(0, 3).every(Number.isFinite)) {
    return fallback.slice();
  }
  return value.slice(0, 3).map(Number);
}

function normalizeMaterial(material) {
  const source = material || {};
  return {
    ambient: vec3From(source.ambient, DEFAULT_MATERIAL.ambient),
    diffuse: vec3From(source.diffuse, DEFAULT_MATERIAL.diffuse),
    specular: vec3From(source.specular, DEFAULT_MATERIAL.specular),
    n: Number.isFinite(Number(source.n)) ? Math.max(1, Number(source.n)) : DEFAULT_MATERIAL.n
  };
}

function computeCenter(vertices) {
  if (!vertices || vertices.length === 0) return vec3.fromValues(0, 0, 0);
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const p of vertices) {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], Number(p[axis]));
      high[axis] = Math.max(high[axis], Number(p[axis]));
    }
  }
  return vec3.fromValues(
    (low[0] + high[0]) * 0.5,
    (low[1] + high[1]) * 0.5,
    (low[2] + high[2]) * 0.5
  );
}

function safeFaceNormal(p0, p1, p2) {
  const a = vec3.fromValues(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const b = vec3.fromValues(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
  const normal = vec3.create();
  vec3.cross(normal, a, b);
  if (vec3.length(normal) < 1e-8) return vec3.fromValues(0, 0, -1);
  vec3.normalize(normal, normal);
  return normal;
}

function fanTriangulate(vertexCount) {
  const triangles = [];
  for (let i = 1; i < vertexCount - 1; i++) triangles.push([0, i, i + 1]);
  return triangles;
}

function makeMeshModel(name, vertices, triangles, normals, material, center, selectable = true) {
  const expandedPositions = [];
  const expandedNormals = [];
  const indices = (Array.isArray(triangles) && triangles.length)
    ? triangles
    : fanTriangulate(vertices ? vertices.length : 0);

  for (const tri of indices) {
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const i0 = tri[0], i1 = tri[1], i2 = tri[2];
    if (![i0, i1, i2].every(i => Number.isInteger(i) && vertices[i])) continue;
    const p0 = vertices[i0], p1 = vertices[i1], p2 = vertices[i2];
    const faceNormal = safeFaceNormal(p0, p1, p2);
    for (const index of [i0, i1, i2]) {
      const position = vertices[index];
      expandedPositions.push(Number(position[0]), Number(position[1]), Number(position[2]));
      let normal = (normals && Array.isArray(normals[index])) ? normals[index] : faceNormal;
      normal = vec3From(normal, Array.from(faceNormal));
      const n = vec3.fromValues(normal[0], normal[1], normal[2]);
      if (vec3.length(n) < 1e-8) vec3.copy(n, faceNormal);
      vec3.normalize(n, n);
      expandedNormals.push(n[0], n[1], n[2]);
    }
  }

  const objectCenter = center ? vec3.fromValues(center[0], center[1], center[2]) : computeCenter(vertices);
  return {
    name,
    positions: new Float32Array(expandedPositions),
    normals: new Float32Array(expandedNormals),
    vertexCount: expandedPositions.length / 3,
    material: normalizeMaterial(material),
    center: objectCenter,
    translation: vec3.create(),
    rotation: quat.create(),
    selectable,
    positionBuffer: null,
    normalBuffer: null
  };
}

function makeTriangleModels(inputTriangles) {
  if (!Array.isArray(inputTriangles)) throw new Error("triangles.json must contain an array of triangle sets.");
  return inputTriangles.map((set, index) => {
    if (!set || !Array.isArray(set.vertices)) {
      throw new Error(`Triangle set ${index} has no vertices array.`);
    }
    return makeMeshModel(
      `Triangle set ${index + 1}`,
      set.vertices,
      set.triangles,
      set.normals,
      set.material,
      null,
      true
    );
  });
}

function makeEllipsoidModel(ellipsoid, index) {
  const center = [Number(ellipsoid.x), Number(ellipsoid.y), Number(ellipsoid.z)];
  const radii = [Math.abs(Number(ellipsoid.a)), Math.abs(Number(ellipsoid.b)), Math.abs(Number(ellipsoid.c))];
  if (![...center, ...radii].every(Number.isFinite) || radii.some(r => r < 1e-6)) {
    throw new Error(`Ellipsoid ${index + 1} has invalid center or radii.`);
  }
  const latitudeSegments = 18;
  const longitudeSegments = 28;
  const vertices = [];
  const normals = [];
  const triangles = [];

  for (let lat = 0; lat <= latitudeSegments; lat++) {
    const phi = Math.PI * lat / latitudeSegments;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let lon = 0; lon <= longitudeSegments; lon++) {
      const theta = 2 * Math.PI * lon / longitudeSegments;
      const unit = [sinPhi * Math.cos(theta), cosPhi, sinPhi * Math.sin(theta)];
      vertices.push([
        center[0] + radii[0] * unit[0],
        center[1] + radii[1] * unit[1],
        center[2] + radii[2] * unit[2]
      ]);
      const n = vec3.fromValues(unit[0] / radii[0], unit[1] / radii[1], unit[2] / radii[2]);
      vec3.normalize(n, n);
      normals.push([n[0], n[1], n[2]]);
    }
  }

  for (let lat = 0; lat < latitudeSegments; lat++) {
    for (let lon = 0; lon < longitudeSegments; lon++) {
      const a = lat * (longitudeSegments + 1) + lon;
      const b = a + longitudeSegments + 1;
      triangles.push([a, b, a + 1], [a + 1, b, b + 1]);
    }
  }

  const material = {
    ambient: ellipsoid.ambient,
    diffuse: ellipsoid.diffuse,
    specular: ellipsoid.specular,
    n: ellipsoid.n
  };
  return makeMeshModel(`Ellipsoid ${index + 1}`, vertices, triangles, normals, material, center, false);
}

function makeTorusModel(name, center, majorRadius, tubeRadius, material, selectable = true) {
  const majorSegments = 72;
  const tubeSegments = 10;
  const vertices = [];
  const normals = [];
  const triangles = [];
  for (let i = 0; i <= majorSegments; i++) {
    const u = 2 * Math.PI * i / majorSegments;
    for (let j = 0; j <= tubeSegments; j++) {
      const v = 2 * Math.PI * j / tubeSegments;
      const cv = Math.cos(v), sv = Math.sin(v);
      vertices.push([
        center[0] + (majorRadius + tubeRadius * cv) * Math.cos(u),
        center[1] + (majorRadius + tubeRadius * cv) * Math.sin(u),
        center[2] + tubeRadius * sv
      ]);
      normals.push([cv * Math.cos(u), cv * Math.sin(u), sv]);
    }
  }
  for (let i = 0; i < majorSegments; i++) {
    for (let j = 0; j < tubeSegments; j++) {
      const a = i * (tubeSegments + 1) + j;
      const b = a + tubeSegments + 1;
      triangles.push([a, b, a + 1], [a + 1, b, b + 1]);
    }
  }
  return makeMeshModel(name, vertices, triangles, normals, material, center, selectable);
}

function makeOctahedronModel(name, center, radius, material) {
  const [x, y, z] = center;
  const vertices = [
    [x + radius, y, z], [x - radius, y, z],
    [x, y + radius, z], [x, y - radius, z],
    [x, y, z + radius], [x, y, z - radius]
  ];
  const triangles = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]
  ];
  return makeMeshModel(name, vertices, triangles, null, material, center, true);
}

function makeCustomScene() {
  const scene = [];
  const center = [0.5, 0.5, 0.60];
  const starMaterial = { ambient: [0.45, 0.55, 0.8], diffuse: [0.35, 0.6, 1], specular: [0.2, 0.35, 0.6], n: 12 };
  const starVertices = [];
  const starTriangles = [];
  const starNormals = [];
  // Small triangles at the back of the scene form a star field.
  for (let i = 0; i < 72; i++) {
    const x = 0.07 + ((i * 37) % 83) / 100;
    const y = 0.07 + ((i * 53) % 83) / 100;
    const z = 0.94 + (i % 4) * 0.006;
    const r = 0.0025 + (i % 4) * 0.001;
    const first = starVertices.length;
    starVertices.push([x, y + r, z], [x - r * 0.7, y - r * 0.5, z], [x + r * 0.7, y - r * 0.5, z]);
    starTriangles.push([first, first + 1, first + 2]);
    starNormals.push([0, 0, -1], [0, 0, -1], [0, 0, -1]);
  }
  scene.push(makeMeshModel("Star field", starVertices, starTriangles, starNormals, starMaterial, [0.5, 0.5, 0.96], false));

  scene.push(makeTorusModel("Outer cyan orbit", center, 0.285, 0.008, {
    ambient: [0.06, 0.28, 0.38], diffuse: [0.08, 0.72, 0.95], specular: [0.75, 0.9, 1], n: 48
  }));
  scene.push(makeTorusModel("Inner violet orbit", [0.5, 0.5, 0.615], 0.205, 0.009, {
    ambient: [0.28, 0.05, 0.34], diffuse: [0.68, 0.15, 0.92], specular: [0.95, 0.7, 1], n: 38
  }));
  scene.push(makeTorusModel("Gold orbit", [0.5, 0.5, 0.59], 0.125, 0.006, {
    ambient: [0.38, 0.18, 0.025], diffuse: [1, 0.57, 0.08], specular: [1, 0.86, 0.5], n: 44
  }));

  scene.push(makeEllipsoidModel({ x: center[0], y: center[1], z: center[2], a: 0.092, b: 0.092, c: 0.092,
    ambient: [0.42, 0.18, 0.025], diffuse: [1, 0.58, 0.08], specular: [1, 0.92, 0.65], n: 64 }, 1));

  const planets = [
    { angle: 0.30, radius: 0.285, size: [0.038, 0.038, 0.038], color: [0.04, 0.82, 0.72], amb: [0.02, 0.27, 0.22] },
    { angle: 2.35, radius: 0.285, size: [0.031, 0.031, 0.031], color: [0.96, 0.20, 0.32], amb: [0.28, 0.035, 0.06] },
    { angle: 4.45, radius: 0.285, size: [0.035, 0.035, 0.035], color: [0.23, 0.42, 1.0], amb: [0.045, 0.08, 0.3] },
    { angle: 1.45, radius: 0.205, size: [0.027, 0.027, 0.027], color: [0.9, 0.42, 0.9], amb: [0.24, 0.06, 0.22] },
    { angle: 3.9, radius: 0.205, size: [0.026, 0.026, 0.026], color: [0.35, 0.9, 0.98], amb: [0.04, 0.22, 0.3] }
  ];
  planets.forEach((planet, index) => {
    const px = 0.5 + Math.cos(planet.angle) * planet.radius;
    const py = 0.5 + Math.sin(planet.angle) * planet.radius;
    const pz = center[2] + ((index % 2) ? -0.035 : 0.035);
    scene.push(makeEllipsoidModel({ x: px, y: py, z: pz, a: planet.size[0], b: planet.size[1], c: planet.size[2],
      ambient: planet.amb, diffuse: planet.color, specular: [0.78, 0.85, 1], n: 38 }, index + 2));
  });

  const crystals = [
    { p: [0.20, 0.24, 0.67], r: 0.045, c: [0.08, 0.85, 0.95], a: [0.03, 0.24, 0.3] },
    { p: [0.80, 0.27, 0.70], r: 0.035, c: [0.95, 0.26, 0.64], a: [0.27, 0.035, 0.16] },
    { p: [0.22, 0.77, 0.68], r: 0.038, c: [0.65, 0.9, 0.2], a: [0.16, 0.24, 0.035] },
    { p: [0.79, 0.77, 0.66], r: 0.048, c: [0.95, 0.55, 0.12], a: [0.28, 0.13, 0.025] }
  ];
  crystals.forEach((c, i) => scene.push(makeOctahedronModel(`Crystal ${i + 1}`, c.p, c.r, {
    ambient: c.a, diffuse: c.c, specular: [0.8, 0.9, 1], n: 36
  })));

  // Add a small moon orbiting one of the planets, plus several tiny accents.
  scene.push(makeEllipsoidModel({ x: 0.5 + Math.cos(0.30) * 0.285 + 0.044, y: 0.5 + Math.sin(0.30) * 0.285 + 0.015,
    z: center[2] + 0.035, a: 0.012, b: 0.012, c: 0.012,
    ambient: [0.25, 0.28, 0.32], diffuse: [0.72, 0.82, 0.9], specular: [0.9, 0.95, 1], n: 24 }, 9));

  customLights = [
    DEFAULT_LIGHT,
    { x: 1.25, y: 0.9, z: 0.15, ambient: [0.08, 0.03, 0.1], diffuse: [0.35, 0.18, 0.85], specular: [0.65, 0.35, 1] },
    { x: -0.25, y: 0.25, z: -0.1, ambient: [0.02, 0.08, 0.1], diffuse: [0.08, 0.45, 0.7], specular: [0.3, 0.65, 1] }
  ];
  return scene;
}

function uploadModel(model) {
  model.positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, model.positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, model.positions, gl.STATIC_DRAW);

  model.normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, model.normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, model.normals, gl.STATIC_DRAW);
}

function compileShader(type, source, description) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unknown shader compiler error";
    gl.deleteShader(shader);
    throw new Error(`${description} compilation failed: ${message}`);
  }
  return shader;
}

function setupShaders() {
  const vertexShaderSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProjection;
    uniform mat3 uNormalMatrix;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    void main(void) {
      vec4 worldPosition = uModel * vec4(aPosition, 1.0);
      vWorldPosition = worldPosition.xyz;
      vWorldNormal = normalize(uNormalMatrix * aNormal);
      gl_Position = uProjection * uView * worldPosition;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    const int MAX_LIGHTS = ${MAX_LIGHTS};
    uniform int uLightCount;
    uniform vec3 uLightPositions[MAX_LIGHTS];
    uniform vec3 uLightAmbient[MAX_LIGHTS];
    uniform vec3 uLightDiffuse[MAX_LIGHTS];
    uniform vec3 uLightSpecular[MAX_LIGHTS];
    uniform vec3 uEyePosition;
    uniform vec3 uMaterialAmbient;
    uniform vec3 uMaterialDiffuse;
    uniform vec3 uMaterialSpecular;
    uniform float uShininess;
    uniform bool uLightingEnabled;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;

    void main(void) {
      if (!uLightingEnabled) {
        gl_FragColor = vec4(clamp(uMaterialDiffuse, 0.0, 1.0), 1.0);
        return;
      }

      vec3 N = normalize(vWorldNormal);
      vec3 V = normalize(uEyePosition - vWorldPosition);
      vec3 totalColor = vec3(0.0);
      for (int i = 0; i < MAX_LIGHTS; i++) {
        if (i < uLightCount) {
          vec3 L = normalize(uLightPositions[i] - vWorldPosition);
          vec3 H = normalize(L + V);
          float nDotL = max(dot(N, L), 0.0);
          float specularFactor = 0.0;
          if (nDotL > 0.0) {
            specularFactor = pow(max(dot(N, H), 0.0), uShininess);
          }
          vec3 ambientTerm = uMaterialAmbient * uLightAmbient[i];
          vec3 diffuseTerm = uMaterialDiffuse * uLightDiffuse[i] * nDotL;
          vec3 specularTerm = uMaterialSpecular * uLightSpecular[i] * specularFactor;
          totalColor += ambientTerm + diffuseTerm + specularTerm;
        }
      }
      gl_FragColor = vec4(clamp(totalColor, 0.0, 1.0), 1.0);
    }
  `;

  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource, "Vertex shader");
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource, "Fragment shader");
  shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);
  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    throw new Error(`Shader program linking failed: ${gl.getProgramInfoLog(shaderProgram)}`);
  }
  gl.useProgram(shaderProgram);

  attribPosition = gl.getAttribLocation(shaderProgram, "aPosition");
  attribNormal = gl.getAttribLocation(shaderProgram, "aNormal");
  gl.enableVertexAttribArray(attribPosition);
  gl.enableVertexAttribArray(attribNormal);
  uniformModel = gl.getUniformLocation(shaderProgram, "uModel");
  uniformView = gl.getUniformLocation(shaderProgram, "uView");
  uniformProjection = gl.getUniformLocation(shaderProgram, "uProjection");
  uniformNormalMatrix = gl.getUniformLocation(shaderProgram, "uNormalMatrix");
  uniformEye = gl.getUniformLocation(shaderProgram, "uEyePosition");
  uniformMatAmbient = gl.getUniformLocation(shaderProgram, "uMaterialAmbient");
  uniformMatDiffuse = gl.getUniformLocation(shaderProgram, "uMaterialDiffuse");
  uniformMatSpecular = gl.getUniformLocation(shaderProgram, "uMaterialSpecular");
  uniformShininess = gl.getUniformLocation(shaderProgram, "uShininess");
  uniformLightingEnabled = gl.getUniformLocation(shaderProgram, "uLightingEnabled");
  uniformLightCount = gl.getUniformLocation(shaderProgram, "uLightCount");
  uniformLightPositions = gl.getUniformLocation(shaderProgram, "uLightPositions[0]");
  uniformLightAmbient = gl.getUniformLocation(shaderProgram, "uLightAmbient[0]");
  uniformLightDiffuse = gl.getUniformLocation(shaderProgram, "uLightDiffuse[0]");
  uniformLightSpecular = gl.getUniformLocation(shaderProgram, "uLightSpecular[0]");
}

function setupWebGL() {
  canvas = document.getElementById("myWebGLCanvas");
  gl = canvas.getContext("webgl", { antialias: true, alpha: false });
  if (!gl) throw new Error("Could not create a WebGL context. Try a browser with WebGL enabled.");
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clearDepth(1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function normalizeLight(light) {
  const source = light || {};
  return {
    position: [Number(source.x) || 0, Number(source.y) || 0, Number(source.z) || 0],
    ambient: vec3From(source.ambient, [1, 1, 1]),
    diffuse: vec3From(source.diffuse, [1, 1, 1]),
    specular: vec3From(source.specular, [1, 1, 1])
  };
}

function uploadLightUniforms(lights) {
  const chosenLights = lights.slice(0, MAX_LIGHTS);
  const positions = new Float32Array(MAX_LIGHTS * 3);
  const ambient = new Float32Array(MAX_LIGHTS * 3);
  const diffuse = new Float32Array(MAX_LIGHTS * 3);
  const specular = new Float32Array(MAX_LIGHTS * 3);
  chosenLights.forEach((light, i) => {
    positions.set(light.position, i * 3);
    ambient.set(light.ambient, i * 3);
    diffuse.set(light.diffuse, i * 3);
    specular.set(light.specular, i * 3);
  });
  gl.uniform1i(uniformLightCount, chosenLights.length);
  gl.uniform3fv(uniformLightPositions, positions);
  gl.uniform3fv(uniformLightAmbient, ambient);
  gl.uniform3fv(uniformLightDiffuse, diffuse);
  gl.uniform3fv(uniformLightSpecular, specular);
}

function cameraBasis() {
  const forward = vec3.clone(cameraForward);
  vec3.normalize(forward, forward);
  const up = vec3.clone(cameraUp);
  vec3.normalize(up, up);
  const right = vec3.create();
  vec3.cross(right, forward, up);
  vec3.normalize(right, right);
  vec3.cross(up, right, forward);
  vec3.normalize(up, up);
  return { right, up, forward };
}

function buildModelMatrix(model, isSelected) {
  const modelMatrix = mat4.create();
  const pivotToOrigin = mat4.create();
  const rotationMatrix = mat4.create();
  const selectedScale = isSelected ? 1.2 : 1.0;
  mat4.fromQuat(rotationMatrix, model.rotation);

  mat4.translate(modelMatrix, modelMatrix, model.translation);
  mat4.translate(modelMatrix, modelMatrix, model.center);
  mat4.multiply(modelMatrix, modelMatrix, rotationMatrix);
  mat4.scale(modelMatrix, modelMatrix, [selectedScale, selectedScale, selectedScale]);
  vec3.negate(pivotToOrigin, model.center);
  mat4.translate(modelMatrix, modelMatrix, pivotToOrigin);
  return modelMatrix;
}

function renderFrame() {
  if (!gl || !shaderProgram) return;
  requestAnimationFrame(renderFrame);

  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  if (customMode) gl.clearColor(0.008, 0.012, 0.055, 1.0);
  else gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(shaderProgram);

  const viewMatrix = mat4.create();
  const target = vec3.create();
  vec3.add(target, cameraEye, cameraForward);
  mat4.lookAt(viewMatrix, cameraEye, target, cameraUp);

  const projectionMatrix = mat4.create();
  mat4.frustum(
    projectionMatrix,
    frustumWindow.left,
    frustumWindow.right,
    frustumWindow.bottom,
    frustumWindow.top,
    NEAR_PLANE,
    FAR_PLANE
  );
  gl.uniformMatrix4fv(uniformView, false, viewMatrix);
  gl.uniformMatrix4fv(uniformProjection, false, projectionMatrix);
  gl.uniform3fv(uniformEye, cameraEye);
  gl.uniform1i(uniformLightingEnabled, lightingEnabled ? 1 : 0);
  uploadLightUniforms(customMode ? customLights : activeLights);

  for (const model of activeSceneModels) {
    if (!model.vertexCount || !model.positionBuffer || !model.normalBuffer) continue;
    const isSelected = selectedIndex >= 0 && selectableModels[selectedIndex] === model;
    const modelMatrix = buildModelMatrix(model, isSelected);
    const normalMatrix = mat3.create();
    if (!mat3.normalFromMat4(normalMatrix, modelMatrix)) mat3.identity(normalMatrix);

    gl.uniformMatrix4fv(uniformModel, false, modelMatrix);
    gl.uniformMatrix3fv(uniformNormalMatrix, false, normalMatrix);
    gl.uniform3fv(uniformMatAmbient, model.material.ambient);
    gl.uniform3fv(uniformMatDiffuse, model.material.diffuse);
    gl.uniform3fv(uniformMatSpecular, model.material.specular);
    gl.uniform1f(uniformShininess, model.material.n);

    gl.bindBuffer(gl.ARRAY_BUFFER, model.positionBuffer);
    gl.vertexAttribPointer(attribPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, model.normalBuffer);
    gl.vertexAttribPointer(attribNormal, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, model.vertexCount);
  }
}

function moveCamera(axisName, amount) {
  const basis = cameraBasis();
  const axis = basis[axisName];
  const displacement = vec3.create();
  vec3.scale(displacement, axis, amount);
  vec3.add(cameraEye, cameraEye, displacement);
}

function rotateCamera(axis, angle, rotateUp = true) {
  const q = quat.create();
  quat.setAxisAngle(q, axis, angle);
  vec3.transformQuat(cameraForward, cameraForward, q);
  vec3.normalize(cameraForward, cameraForward);
  if (rotateUp) {
    vec3.transformQuat(cameraUp, cameraUp, q);
    vec3.normalize(cameraUp, cameraUp);
  }
  const basis = cameraBasis();
  vec3.copy(cameraUp, basis.up);
}

function translateSelected(axisName, amount) {
  if (selectedIndex < 0 || !selectableModels[selectedIndex]) return;
  const basis = cameraBasis();
  const displacement = vec3.create();
  vec3.scale(displacement, basis[axisName], amount);
  vec3.add(selectableModels[selectedIndex].translation, selectableModels[selectedIndex].translation, displacement);
}

function rotateSelected(axisName, angle) {
  if (selectedIndex < 0 || !selectableModels[selectedIndex]) return;
  const basis = cameraBasis();
  const qDelta = quat.create();
  quat.setAxisAngle(qDelta, basis[axisName], angle);
  const model = selectableModels[selectedIndex];
  quat.multiply(model.rotation, qDelta, model.rotation);
  quat.normalize(model.rotation, model.rotation);
}

function cycleSelection(direction) {
  if (!selectableModels.length) {
    selectedIndex = -1;
    updateStatus();
    return;
  }
  if (selectedIndex < 0) selectedIndex = (direction > 0) ? 0 : selectableModels.length - 1;
  else selectedIndex = (selectedIndex + direction + selectableModels.length) % selectableModels.length;
  updateStatus();
}

function toggleCustomScene() {
  customMode = !customMode;
  if (customMode) {
    activeSceneModels = customSceneModels;
    selectableModels = customSceneModels.filter(model => model.selectable);
    selectedIndex = -1;
  } else {
    activeSceneModels = normalSceneModels;
    selectableModels = triangleModels;
    selectedIndex = -1;
  }
  updateStatus();
}

function handleKeyDown(event) {
  const key = event.key;
  const basis = cameraBasis();
  const usesKey = [
    "a", "d", "w", "s", "q", "e", "A", "D", "W", "S",
    "ArrowLeft", "ArrowRight", " ", "Spacebar", "k", ";", "o", "l", "i", "p",
    "K", ":", "O", "L", "I", "P", "!", "b", "B"
  ].includes(key);
  if (usesKey) event.preventDefault();

  switch (key) {
    // Camera translations in view axes.
    case "a": moveCamera("right", -MOVE_STEP); break;
    case "d": moveCamera("right", MOVE_STEP); break;
    case "w": moveCamera("forward", MOVE_STEP); break;
    case "s": moveCamera("forward", -MOVE_STEP); break;
    case "q": moveCamera("up", MOVE_STEP); break;
    case "e": moveCamera("up", -MOVE_STEP); break;
    // Camera yaw around its current up, and pitch around its current right.
    case "A": rotateCamera(basis.up, ROTATE_STEP, false); break;
    case "D": rotateCamera(basis.up, -ROTATE_STEP, false); break;
    case "W": rotateCamera(basis.right, ROTATE_STEP, true); break;
    case "S": rotateCamera(basis.right, -ROTATE_STEP, true); break;

    case "ArrowLeft": cycleSelection(-1); break;
    case "ArrowRight": cycleSelection(1); break;
    case " ":
    case "Spacebar": selectedIndex = -1; updateStatus(); break;

    // Selected model translation (all translations happen after its rotation).
    case "k": translateSelected("right", -MOVE_STEP); break;
    case ";": translateSelected("right", MOVE_STEP); break;
    case "o": translateSelected("forward", MOVE_STEP); break;
    case "l": translateSelected("forward", -MOVE_STEP); break;
    case "i": translateSelected("up", MOVE_STEP); break;
    case "p": translateSelected("up", -MOVE_STEP); break;
    // Selected model rotation around view-space Y, X and Z axes.
    case "K": rotateSelected("up", ROTATE_STEP); break;
    case ":": rotateSelected("up", -ROTATE_STEP); break;
    case "O": rotateSelected("right", ROTATE_STEP); break;
    case "L": rotateSelected("right", -ROTATE_STEP); break;
    case "I": rotateSelected("forward", ROTATE_STEP); break;
    case "P": rotateSelected("forward", -ROTATE_STEP); break;

    case "!": toggleCustomScene(); break;
    case "b":
    case "B": lightingEnabled = !lightingEnabled; updateStatus(); break;
    default: return;
  }
  updateStatus();
}

function applyDisplaySettings() {
  const width = Math.round(Number(document.getElementById("canvasWidth").value));
  const height = Math.round(Number(document.getElementById("canvasHeight").value));
  const left = Number(document.getElementById("frustumLeft").value);
  const right = Number(document.getElementById("frustumRight").value);
  const bottom = Number(document.getElementById("frustumBottom").value);
  const top = Number(document.getElementById("frustumTop").value);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64 || width > 2048 || height > 2048) {
    showError("Canvas width and height must be between 64 and 2048 pixels.");
    return;
  }
  if (![left, right, bottom, top].every(Number.isFinite) || left >= right || bottom >= top) {
    showError("Frustum values must be numeric, with left < right and bottom < top.");
    return;
  }

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  frustumWindow = { left, right, bottom, top };
  gl.viewport(0, 0, width, height);
  clearError();
  updateStatus();
}

function showError(message) {
  lastError = message;
  const output = document.getElementById("status");
  if (output) output.textContent = message;
  console.error(message);
}

function clearError() {
  lastError = "";
}

function updateStatus() {
  const output = document.getElementById("status");
  if (!output) return;
  if (lastError) {
    output.textContent = lastError;
    return;
  }
  let selectionText = "No model selected";
  if (selectedIndex >= 0 && selectableModels[selectedIndex]) {
    selectionText = `Selected: ${selectableModels[selectedIndex].name}`;
  }
  const modeText = customMode ? "Custom scene (press ! to return)" : "Input scene";
  const lightText = lightingEnabled ? "Blinn–Phong lighting ON" : "Unlit diffuse colors (press B to enable lighting)";
  output.textContent = `${modeText} · ${lightText} · ${selectionText}`;
}

async function main() {
  try {
    setupWebGL();
    setupShaders();
    const [inputTriangles, inputLights, inputEllipsoids] = await Promise.all([
      fetchJSON(INPUT_TRIANGLES_URL, "triangles"),
      fetchJSON(INPUT_LIGHTS_URL, "lights"),
      fetchJSON(INPUT_ELLIPSOIDS_URL, "ellipsoids")
    ]);

    triangleModels = makeTriangleModels(inputTriangles);
    ellipsoidModels = Array.isArray(inputEllipsoids)
      ? inputEllipsoids.map((item, i) => makeEllipsoidModel(item, i))
      : [];
    normalSceneModels = triangleModels.concat(ellipsoidModels);
    customSceneModels = makeCustomScene();
    activeSceneModels = normalSceneModels;
    selectableModels = triangleModels;

    activeLights = [normalizeLight(DEFAULT_LIGHT)];
    if (Array.isArray(inputLights)) activeLights = activeLights.concat(inputLights.map(normalizeLight));
    activeLights = activeLights.slice(0, MAX_LIGHTS);
    customLights = customLights.map(normalizeLight).slice(0, MAX_LIGHTS);

    [...normalSceneModels, ...customSceneModels].forEach(uploadModel);
    document.getElementById("applySettings").addEventListener("click", applyDisplaySettings);
    document.addEventListener("keydown", handleKeyDown, { passive: false });
    updateStatus();
    renderFrame();
  } catch (error) {
    console.error(error);
    showError(`Startup failed: ${error.message || error}. Run this page from a local web server and check the browser console/network tab.`);
  }
}

window.main = main;
