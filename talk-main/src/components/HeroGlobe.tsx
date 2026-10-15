import { useEffect, useRef } from 'react';

const peoplePortraits = [
  { src: '/assets/stitch/image-05.jpg', position: 'center' },
  { src: '/assets/stitch/image-07.jpg', position: 'center' },
  { src: '/assets/stitch/image-02.jpg', position: '55% 40%' },
  { src: '/assets/stitch/image-12.jpg', position: '50% 15%' },
  { src: '/assets/stitch/image-13.jpg', position: '48% 30%' },
  { src: '/assets/stitch/image-14.jpg', position: '55% 35%' },
];
// Latitude / longitude pairs anchor the glowing network to the rotating Earth.
const networkSites = [
  [51.5, -.1], [48.9, 2.4], [40.7, -74], [34.1, -118.2], [-23.6, -46.6], [-33.9, 18.4],
  [25.2, 55.3], [19.1, 72.9], [28.6, 77.2], [1.3, 103.8], [22.3, 114.2], [35.7, 139.7],
  [-33.9, 151.2], [-6.2, 106.8], [-1.3, 36.8], [19.4, -99.1], [43.7, -79.4], [52.5, 13.4],
  [39.9, 116.4], [37.6, 127], [30, 31.2], [6.5, 3.4], [14.7, -17.4], [40.4, -3.7],
  [41.9, 12.5], [41, 29], [55.8, 37.6], [24.7, 46.7], [13.8, 100.5], [25, 121.5],
  [14.6, 121], [-31.9, 115.9], [23.8, 90.4], [24.9, 67], [36.8, 3.1], [51.2, 71.4],
];
const networkRoutes = [
  [0, 1], [0, 2], [0, 6], [0, 17], [1, 5], [1, 8], [2, 3], [2, 4], [2, 15], [2, 16],
  [3, 11], [4, 5], [5, 14], [6, 7], [6, 8], [6, 14], [7, 8], [7, 9], [8, 18], [9, 10],
  [9, 12], [9, 13], [10, 11], [10, 18], [11, 12], [11, 19], [17, 18], [18, 19],
  [0, 23], [1, 23], [1, 24], [1, 34], [17, 24], [17, 26], [17, 35], [23, 34], [24, 25],
  [24, 20], [25, 20], [25, 26], [25, 27], [26, 35], [35, 18], [35, 8], [20, 27], [20, 14],
  [20, 21], [21, 22], [21, 34], [21, 5], [22, 4], [6, 27], [6, 33], [27, 33], [33, 7],
  [33, 8], [8, 32], [32, 28], [28, 9], [28, 10], [28, 30], [29, 18], [29, 19], [29, 30],
  [29, 10], [30, 13], [13, 31], [31, 12],
];
type WorldPoint = [number, number, number];
const siteVectors: WorldPoint[] = networkSites.map(([latitude, longitude]) => {
  const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
});
// Sample each curved route once; animation only rotates these fixed points.
const routePoints = networkRoutes.map(([start, end]) => Array.from({ length: 29 }, (_, step): WorldPoint => {
  const t = step / 28, a = siteVectors[start], b = siteVectors[end];
  const x = a[0] * (1 - t) + b[0] * t, y = a[1] * (1 - t) + b[1] * t, z = a[2] * (1 - t) + b[2] * t;
  const scale = (1 + Math.sin(t * Math.PI) * .045) / Math.hypot(x, y, z);
  return [x * scale, y * scale, z * scale];
}));
const vertexSource = `
  attribute vec2 position;
  void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;
const fragmentSource = `
  precision highp float;
  uniform sampler2D earth;
  uniform vec2 center;
  uniform float radius;
  uniform float rotation;
  void main() {
    vec2 point = (gl_FragCoord.xy - center) / radius;
    float distance = length(point);
    float edge = 1.5 / radius;
    if (distance > 1.0) discard;
    vec3 normal = vec3(point, sqrt(max(0.0, 1.0 - dot(point, point))));
    float tilt = .13;
    vec3 tilted = vec3(normal.x * cos(tilt) - normal.y * sin(tilt), normal.x * sin(tilt) + normal.y * cos(tilt), normal.z);
    vec2 uv = vec2(fract(.5 + (atan(tilted.x, tilted.z) + rotation) / 6.2831853), .5 - asin(clamp(tilted.y, -1.0, 1.0)) / 3.1415927);
    vec3 atlas = texture2D(earth, uv).rgb;
    float sunlight = max(dot(normal, normalize(vec3(.3, .65, .8))), 0.0);
    float land = smoothstep(-.015, .025, max(atlas.r - atlas.b * .78, atlas.g - atlas.b * .98));
    vec3 ocean = mix(vec3(.015, .055, .16), vec3(.025, .24, .43), sunlight);
    vec3 color = mix(ocean, atlas, land) * (.58 + sunlight * .55);
    color = pow(color, vec3(.82));
    // A narrow atmospheric edge, without changing the circle's silhouette.
    color += vec3(.08, .5, .8) * pow(1.0 - normal.z, 5.0) * .35;
    gl_FragColor = vec4(color, 1.0 - smoothstep(1.0 - edge, 1.0, distance));
  }
`;

export default function HeroGlobe() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbitRef = useRef<SVGSVGElement>(null);
  const networkRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const scene = sceneRef.current, canvas = canvasRef.current, orbits = orbitRef.current;
    if (!scene || !canvas || !orbits) return;
    const people = Array.from(scene.querySelectorAll<HTMLElement>('.hero-globe-person'));
    const rings = Array.from(orbits.querySelectorAll('ellipse'));
    const connections = orbits.querySelector('path');
    const fallbackAtlas = scene.querySelector<SVGGElement>('.hero-fallback-atlas');
    const network = networkRef.current;
    const routeElements = Array.from(network?.querySelectorAll<SVGPathElement>('.hero-earth-route') || []);
    const pinElements = Array.from(network?.querySelectorAll<SVGGElement>('.hero-earth-pin') || []);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, powerPreference: 'low-power' });
    let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null, texture: WebGLTexture | null = null;
    const shaders: WebGLShader[] = [];
    let centerLocation: WebGLUniformLocation | null = null, radiusLocation: WebGLUniformLocation | null = null, rotationLocation: WebGLUniformLocation | null = null;
    let gpuReady = false, disposed = false, visible = true, frameId = 0, previousTime: number | null = null, rotation = 1.08, portraitRotation = .6;
    let width = 0, height = 0, cx = 0, cy = 0, radius = 0, ratio = 1, personSize = 64;
    let orbitRadiusX = 0, orbitRadiusY = 0;
    const copy = scene.closest('.hero-intro')?.querySelector('.hero-copy');
    let protectedAreas: { left: number; right: number; top: number; bottom: number }[] = [];
    try {
      if (gl) {
        const compile = (type: number, source: string) => {
          const shader = gl.createShader(type);
          if (!shader) throw new Error('Shader unavailable');
          shaders.push(shader);
          gl.shaderSource(shader, source); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed');
          return shader;
        };
        program = gl.createProgram();
        if (!program) throw new Error('Program unavailable');
        gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program linking failed');
        gl.useProgram(program);
        buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        centerLocation = gl.getUniformLocation(program, 'center');
        radiusLocation = gl.getUniformLocation(program, 'radius');
        rotationLocation = gl.getUniformLocation(program, 'rotation');
        texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(gl.getUniformLocation(program, 'earth'), 0);
      }
    } catch {
      canvas.style.display = 'none';
    }

    const tiltCos = Math.cos(.13), tiltSin = Math.sin(.13);
    let spinCos = 0, spinSin = 0;
    const project = ([vx, vy, vz]: WorldPoint) => {
      const x = vx * spinCos - vz * spinSin, z = vx * spinSin + vz * spinCos;
      return { x: cx + radius * (x * tiltCos + vy * tiltSin), y: cy - radius * (-x * tiltSin + vy * tiltCos), z };
    };
    // The camera and sphere size are fixed; longitude, routes and pins rotate together.
    const paint = () => {
      if (disposed || !width || !height) return;
      spinCos = Math.cos(rotation); spinSin = Math.sin(rotation);
      if (gl && gpuReady) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(centerLocation, cx * ratio, (height - cy) * ratio);
        gl.uniform1f(radiusLocation, radius * ratio); gl.uniform1f(rotationLocation, rotation);
        gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.SCISSOR_TEST);
        const extent = Math.ceil(radius * ratio * 1.04);
        gl.scissor(Math.round(cx * ratio) - extent, Math.round((height - cy) * ratio) - extent, extent * 2, extent * 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (fallbackAtlas) fallbackAtlas.setAttribute('transform', `translate(${-256 - (rotation % (Math.PI * 2)) * 1024 / (Math.PI * 2)} 0)`);
      pinElements.forEach((pin, index) => {
        const point = project(siteVectors[index]);
        const covered = protectedAreas.some(area => point.x + 6 > area.left && point.x - 6 < area.right && point.y + 6 > area.top && point.y - 12 < area.bottom);
        pin.setAttribute('transform', `translate(${point.x} ${point.y}) scale(${.7 + Math.max(0, point.z) * .4})`);
        pin.style.opacity = covered ? '0' : String(Math.max(0, Math.min(1, point.z * 5)));
      });
      routeElements.forEach((route, index) => {
        let d = '', drawing = false;
        for (const sample of routePoints[index]) {
          const point = project(sample);
          if (point.z <= .025) { drawing = false; continue; }
          d += `${drawing ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)} `; drawing = true;
        }
        route.setAttribute('d', d);
      });
      const size = personSize;
      const positions = people.map((person, index) => {
        const angle = portraitRotation + index * Math.PI * 2 / people.length;
        const x = cx + orbitRadiusX * Math.cos(angle);
        const y = cy + orbitRadiusY * Math.sin(angle);
        // Complete an orbit while fading before crossing the foreground copy.
        const clearance = protectedAreas.reduce((distance, area) => {
          const dx = Math.max(area.left - (x + size / 2), x - size / 2 - area.right, 0);
          const dy = Math.max(area.top - (y + size / 2), y - size / 2 - area.bottom, 0);
          return Math.min(distance, Math.hypot(dx, dy));
        }, 24);
        person.style.opacity = String(Math.min(1, clearance / 24));
        person.style.transform = `translate3d(${x - size / 2}px, ${y - size / 2}px, 0)`;
        return [x, y];
      });
      connections?.setAttribute('d', positions.map(([x, y], index) => {
        const [nextX, nextY] = positions[(index + 1) % positions.length];
        return `M ${x} ${y} Q ${cx} ${cy} ${nextX} ${nextY}`;
      }).join(' '));
    };
    const animate = (time: number) => {
      if (disposed || motion.matches || !visible || document.hidden) { previousTime = null; return; }
      if (previousTime !== null) {
        const elapsed = Math.min((time - previousTime) / 1000, .05);
        rotation += elapsed * .055;
        portraitRotation += elapsed * .12;
      }
      previousTime = time; paint();
      frameId = requestAnimationFrame(animate);
    };
    const updateMotion = () => {
      cancelAnimationFrame(frameId); previousTime = null; paint();
      if (!motion.matches && visible && !document.hidden && !disposed) frameId = requestAnimationFrame(animate);
    };
    const resize = () => {
      const bounds = scene.getBoundingClientRect();
      width = bounds.width; height = bounds.height; cx = width / 2; cy = height * .48;
      const protectedElements = [
        ...Array.from(copy?.querySelectorAll('h1, p, .hero-announcement, .hero-actions') || []),
        ...Array.from(document.querySelectorAll('.skin-header, #feature-tabs > p')),
      ];
      protectedAreas = protectedElements.map(element => {
        const area = element.getBoundingClientRect();
        return { left: area.left - bounds.left - 12, right: area.right - bounds.left + 12, top: area.top - bounds.top - 12, bottom: area.bottom - bounds.top + 12 };
      });
      radius = Math.min(height * .385, width * .41);
      personSize = people[0]?.getBoundingClientRect().width || 64;
      orbitRadiusX = Math.max(0, Math.min(radius * 2.15, width / 2 - personSize / 2 - 16));
      orbitRadiusY = Math.max(0, Math.min(radius * 1.1, cy - personSize / 2 - 16, height - cy - personSize / 2 - 16));
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      scene.style.setProperty('--earth-size', `${radius * 2}px`);
      scene.style.setProperty('--earth-x', `${cx}px`); scene.style.setProperty('--earth-y', `${cy}px`);
      orbits.setAttribute('viewBox', `0 0 ${width} ${height}`);
      network?.setAttribute('viewBox', `0 0 ${width} ${height}`);
      rings.forEach((ring, index) => {
        ring.setAttribute('cx', String(cx)); ring.setAttribute('cy', String(cy));
        ring.setAttribute('rx', String(orbitRadiusX)); ring.setAttribute('ry', String(orbitRadiusY * (index ? .8 : 1)));
        ring.removeAttribute('transform');
      });
      paint();
    };
    const image = new Image();
    image.onload = () => {
      if (disposed || !gl || !program || !texture || canvas.style.display === 'none') return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      if ((image.width & (image.width - 1)) === 0 && (image.height & (image.height - 1)) === 0) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      }
      gpuReady = true; scene.dataset.renderer = 'webgl'; paint();
    };
    image.src = '/reference/earth-color.jpg';
    const loseContext = (event: Event) => { event.preventDefault(); gpuReady = false; scene.dataset.renderer = 'fallback'; canvas.style.display = 'none'; paint(); };
    canvas.addEventListener('webglcontextlost', loseContext);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(scene);
    if (copy) resizeObserver.observe(copy);
    document.querySelectorAll('.skin-header, #feature-tabs > p').forEach(element => resizeObserver.observe(element));
    document.fonts.ready.then(() => { if (!disposed) resize(); });
    const intersectionObserver = new IntersectionObserver(() => {
      // Use the current bounds: a resize can batch older intersection records.
      const bounds = scene.getBoundingClientRect();
      visible = bounds.bottom > 0 && bounds.top < window.innerHeight && bounds.right > 0 && bounds.left < window.innerWidth;
      updateMotion();
    });
    intersectionObserver.observe(scene);
    motion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateMotion);
    resize(); updateMotion();
    return () => {
      disposed = true; cancelAnimationFrame(frameId); image.onload = null;
      resizeObserver.disconnect(); intersectionObserver.disconnect();
      motion.removeEventListener('change', updateMotion); document.removeEventListener('visibilitychange', updateMotion);
      canvas.removeEventListener('webglcontextlost', loseContext);
      if (gl) { if (texture) gl.deleteTexture(texture); if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); shaders.forEach(shader => gl.deleteShader(shader)); }
    };
  }, []);
  return <div ref={sceneRef} className="hero-earth-scene" aria-hidden="true">
    <svg ref={orbitRef} className="hero-globe-orbits" focusable="false"><ellipse /><ellipse /><path /></svg>
    <div className="hero-earth-fallback">
      <svg viewBox="0 0 512 512" width="100%" height="100%" focusable="false">
        <defs>
          <radialGradient id="hero-earth-shade" cx="60%" cy="30%" r="75%"><stop stopColor="#8ac1e5" stopOpacity=".1" /><stop offset=".6" stopColor="#005bff" stopOpacity=".1" /><stop offset="1" stopColor="#071c47" stopOpacity=".65" /></radialGradient>
        </defs>
        <g className="hero-fallback-atlas">{[-1024, 0, 1024].map(x => <image key={x} href="/reference/earth-color.jpg" x={x} y="0" width="1024" height="512" preserveAspectRatio="none" />)}</g>
        <rect width="512" height="512" fill="url(#hero-earth-shade)" />
      </svg>
    </div>
    <canvas ref={canvasRef} className="hero-earth-canvas" />
    <svg ref={networkRef} className="hero-earth-network" focusable="false">
      {networkRoutes.map((_, index) => <path key={index} className="hero-earth-route" />)}
      {networkSites.map((_, index) => <g key={index} className="hero-earth-pin"><ellipse cx="0" cy="0" rx="5" ry="2" className="hero-earth-pin-base" /><path d="M0 0C-1-2-4-5-4-8A4 4 0 1 1 4-8C4-5 1-2 0 0Z" /><circle cx="0" cy="-8" r="1.5" /></g>)}
    </svg>
    {peoplePortraits.map(({ src, position }) => <div className="hero-globe-person" key={src}><img src={src} alt="" draggable="false" style={{ objectPosition: position }} /></div>)}
  </div>;
}
