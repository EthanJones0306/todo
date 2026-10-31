/**
 * Animated backgrounds for the motion themes.
 *
 * Adapted from Subframe Motion Library examples: "Paper swarm", "Aurora curtain", "Point cloud wave",
 * "Contour terrain" (as a honeycomb for Hive) and "Meteors". Colours and speeds are toned down so the
 * motion sits quietly behind a task list.
 *
 * MIT License
 * Copyright (c) 2026 Subframe
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
'use client'

import { useEffect, useRef, useState } from 'react'

type Scene = 'swarm' | 'aurora' | 'swell' | 'contour' | 'nightsky'
const SCENES: Scene[] = ['swarm', 'aurora', 'swell', 'contour', 'nightsky']
const CANVAS_SCENES: Scene[] = ['swarm', 'aurora', 'swell', 'contour']
/** Scenes that respond to the mouse. */
const POINTER_SCENES: Scene[] = ['swarm', 'swell', 'contour']

/** A running scene. `play` starts or stops the motion; when stopped it shows a still frame. */
interface SceneHandle {
  play: (on: boolean) => void
  /** Mouse position in page (CSS) pixels, or null once it leaves the window. */
  point?: (pos: { x: number; y: number } | null) => void
  destroy: () => void
}

/** Which scene the current theme wants, and whether motion is allowed (app setting + OS setting). */
function useSceneState() {
  const [scene, setScene] = useState<Scene | null>(null)
  const [still, setStill] = useState(true)
  useEffect(() => {
    const root = document.documentElement
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const read = () => {
      const theme = root.getAttribute('data-theme') as Scene | null
      setScene(theme && SCENES.includes(theme) ? theme : null)
      setStill(query.matches || root.hasAttribute('data-reduce-motion'))
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-reduce-motion'] })
    query.addEventListener('change', read)
    return () => {
      observer.disconnect()
      query.removeEventListener('change', read)
    }
  }, [])
  return { scene, still }
}

/** Keeps a canvas sized to its box at up to 2x pixel density (less on very large screens). */
function fitCanvas(canvas: HTMLCanvasElement, maxPixels: number) {
  const rect = canvas.getBoundingClientRect()
  const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(maxPixels / Math.max(1, rect.width * rect.height)))
  const w = Math.max(1, Math.round(rect.width * ratio))
  const h = Math.max(1, Math.round(rect.height * ratio))
  const changed = canvas.width !== w || canvas.height !== h
  if (changed) {
    canvas.width = w
    canvas.height = h
  }
  return { cssW: rect.width, cssH: rect.height, changed }
}

/* ---------- Paper swarm: printed sheets tumbling upward through a blue volume (WebGL2) ---------- */

const SWARM_VERTEX = `#version 300 es
precision highp float;
in vec2 corner;
in vec4 sheet;
uniform float time;
uniform float aspect;
uniform vec2 camera;
out vec2 uv;
out float edition;
out float depth;
void main(){
  float seed=sheet.w;
  float angle=seed*6.283+time*(.16+seed*.22);
  vec3 point=vec3(corner.x*cos(angle),corner.y,corner.x*sin(angle))*(.42+seed*.55);
  float roll=sin(seed*24.+time*.13)*.7;
  point.xy=mat2(cos(roll),-sin(roll),sin(roll),cos(roll))*point.xy;
  point+=vec3(sheet.x,mod(sheet.y+time*(.22+seed*.34)+8.,16.)-8.,sheet.z);
  point.xz=mat2(cos(camera.x),-sin(camera.x),sin(camera.x),cos(camera.x))*point.xz;
  point.yz=mat2(cos(camera.y),-sin(camera.y),sin(camera.y),cos(camera.y))*point.yz;
  float distance=point.z+11.;
  gl_Position=vec4(point.x*1.55/aspect,point.y*1.55,(distance-1.)/18.*2.-1.,distance);
  uv=corner+vec2(.5,.7);uv/=vec2(1.,1.4);edition=seed;depth=clamp((distance-6.)/10.,0.,1.);
}`

const SWARM_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
in float edition;
in float depth;
out vec4 color;
void main(){
  // PCH palette: white and PCH blue sheets, the odd gold one, printed in PCH navy.
  vec3 paper=mix(vec3(.21,.60,.72),vec3(.95,.97,.99),step(.45,edition));
  paper=mix(paper,vec3(.85,.68,0.),step(.92,edition));
  vec3 ink=vec3(0.,.184,.424);
  float margin=step(.12,uv.x)*step(uv.x,.88);
  float lines=step(.68,fract(uv.y*24.))*step(.12,uv.y)*step(uv.y,.42)*margin;
  float title=step(.61,uv.y)*step(uv.y,.83)*margin;
  float cut=step(.32,uv.x)*step(uv.x,.46);
  title*=1.-cut;
  float fold=smoothstep(.38,.5,uv.x)*.10-smoothstep(.5,.62,uv.x)*.10;
  vec3 paint=mix(paper,ink,max(lines,title));
  paint*=1.-fold;
  // Fade sheets into the navy field so they read as texture, not clutter.
  color=vec4(mix(paint,vec3(0.,.141,.353),.30+depth*.50),1.);
}`

function startSwarm(canvas: HTMLCanvasElement): SceneHandle | null {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const buffers: WebGLBuffer[] = []
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  const free = () => {
    buffers.forEach(b => gl.deleteBuffer(b))
    shaders.forEach(s => gl.deleteShader(s))
    if (program) gl.deleteProgram(program)
    if (vao) gl.deleteVertexArray(vao)
  }
  const COUNT = 110
  try {
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind)
      if (!shader) throw new Error('shader')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('compile')
      return shader
    }
    program = gl.createProgram()
    if (!program) throw new Error('program')
    gl.attachShader(program, compile(gl.VERTEX_SHADER, SWARM_VERTEX))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, SWARM_FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link')
    gl.useProgram(program)
    vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const attribute = (name: string, data: Float32Array, size: number, divisor: number) => {
      const buffer = gl.createBuffer()
      if (!buffer) throw new Error('buffer')
      buffers.push(buffer)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      const location = gl.getAttribLocation(program!, name)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(location, divisor)
    }
    attribute('corner', new Float32Array([-0.5, -0.7, 0.5, -0.7, -0.5, 0.7, -0.5, 0.7, 0.5, -0.7, 0.5, 0.7]), 2, 0)
    const sheets = new Float32Array(COUNT * 4)
    let seed = 31
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let i = 0; i < COUNT; i++) {
      sheets.set([(random() - 0.5) * 21, (random() - 0.5) * 16, (random() - 0.5) * 9, random()], i * 4)
    }
    attribute('sheet', sheets, 4, 1)
  } catch {
    free()
    return null
  }

  const timeU = gl.getUniformLocation(program, 'time')
  const aspectU = gl.getUniformLocation(program, 'aspect')
  const cameraU = gl.getUniformLocation(program, 'camera')
  gl.enable(gl.DEPTH_TEST)
  gl.clearColor(0, 0.141, 0.353, 1)

  let time = 9
  let raf = 0
  let last = 0
  let playing = false
  let stopped = false
  let camX = 0
  let camY = 0
  let targetX = 0
  let targetY = 0

  const render = (now: number) => {
    raf = 0
    if (stopped || gl.isContextLost()) return
    const moving = playing && !document.hidden
    // The sheets drift slowly here; the original moves faster as a showcase.
    const dt = last ? Math.min((now - last) / 1000, 0.04) : 0
    last = moving ? now : 0
    if (moving) {
      time += dt * 0.5
      const ease = 1 - Math.exp(-3 * dt)
      camX += (targetX - camX) * ease
      camY += (targetY - camY) * ease
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.uniform1f(timeU, time)
    gl.uniform1f(aspectU, canvas.width / canvas.height)
    gl.uniform2f(cameraU, camX, camY)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, COUNT)
    if (moving) raf = requestAnimationFrame(render)
  }
  const request = () => {
    if (!raf && !stopped) raf = requestAnimationFrame(render)
  }
  const resize = () => {
    fitCanvas(canvas, 3_600_000)
    request()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  document.addEventListener('visibilitychange', request)
  const lost = (e: Event) => {
    e.preventDefault()
    cancelAnimationFrame(raf)
    raf = 0
  }
  canvas.addEventListener('webglcontextlost', lost)
  resize()

  return {
    play(on) {
      playing = on
      if (!on) {
        targetX = targetY = camX = camY = 0
        last = 0
      }
      request()
    },
    point(pos) {
      if (!playing) return
      targetX = pos ? (pos.x / innerWidth - 0.5) * 0.3 : 0
      targetY = pos ? (pos.y / innerHeight - 0.5) * 0.15 : 0
    },
    destroy() {
      stopped = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      document.removeEventListener('visibilitychange', request)
      canvas.removeEventListener('webglcontextlost', lost)
      free()
    },
  }
}

/* ---------- Full-screen shader scenes (WebGL1): Aurora, Swell, Hive ---------- */

/** Aurora curtain: soft green curtains over a night sky, dimmed so white text stays readable. */
const AURORA_FRAGMENT = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.13,311.71)))*43719.17);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
void main(){
 vec2 uv=gl_FragCoord.xy/u_resolution;
 vec2 p=(gl_FragCoord.xy-.5*u_resolution)/u_resolution.y;
 float activity=.35,t=u_time*(.09+activity*.07);
 vec3 color=mix(vec3(.003,.012,.025),vec3(.01,.035,.055),uv.y);
 for(int i=0;i<3;i++){
  float layer=float(i),x=p.x+layer*.42;
  float bend=.15*sin(x*2.2+t*.25)+(.03+activity*.08)*sin(x*4.8-t*.6+layer);
  float hem=-.10-layer*.13+bend+(.012+activity*.028)*(noise(vec2(x*15.,t*.35+layer))-.5);
  float rise=p.y-hem;
  float drift=x+rise*.1+(.017+activity*.015)*noise(vec2(x*8.,t*.2+layer));
  float grain=noise(vec2(drift*145.,t*.4+layer*4.));
  float fine=noise(vec2(drift*310.,t*.17+layer));
  float threads=.36+.64*pow(grain,.7)+fine*.17;
  float patches=.48+.8*noise(vec2(x*8.+layer,t*.13));
  float reach=5.5+noise(vec2(x*11.,layer+4.))*5.-activity*1.5;
  float veil=smoothstep(-.012,.022,rise)*exp(-max(rise,0.)*reach);
  float lip=exp(-abs(rise)/(.007+grain*.013));
  float halo=exp(-abs(rise)*16.)*.12;
  float amount=pow(.32,layer)*patches;
  vec3 tint=mix(vec3(.10,.84,.40),vec3(.025,.28,.32),smoothstep(.02,.38,max(0.,rise)));
  color+=amount*(tint*(veil*threads*(.5+activity*.52)+halo)+vec3(.46,1.0,.70)*lip*threads*(.55+activity*.4));
 }
 vec2 star=p*150.,cell=floor(star);
 float points=step(.9974,hash(cell))*(1.-smoothstep(.02,.14,length(fract(star)-.5)));
 color+=points*.42*(1.-smoothstep(.1,.8,color.g));
 color*=.88+.12*pow(max(0.,1.-length(p)*.6),.6);
 gl_FragColor=vec4((1.-exp(-color*1.4))*.7,1.);
}
`

/**
 * Point cloud wave: rows of small ultramarine dots swelling slowly on pale grey. Near the mouse the
 * dots lift, grow and brighten, with a soft ripple running out from the pointer.
 */
const SWELL_FRAGMENT = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_hover;
void main() {
  vec2 p=(gl_FragCoord.xy-.5*u_resolution)/min(u_resolution.x,u_resolution.y);
  vec2 m=(u_mouse-.5*u_resolution)/min(u_resolution.x,u_resolution.y);
  vec3 c=vec3(.90,.92,.94);
  // More rows, spaced further apart than the original, so the swell fills the lower half of the screen.
  for(int i=0;i<40;i++) {
    float row=float(i);
    float z=.45+row*.039;
    float scale=1.0/(1.0+z);
    float xCell=floor(p.x/scale*28.0+.5);
    float x=xCell/28.0;
    float height=sin(x*5.0+z*4.0-u_time*.48)*.1+.04*cos(x*9.0-z*3.0);
    vec2 spot=vec2(x*scale,(.3-z*.31)*scale*2.3-.1+height*scale);
    float md=length(spot-m);
    float near=u_hover*exp(-md*md*12.);
    float ripple=.7+.3*sin(md*45.-u_time*4.);
    float lift=near*ripple;
    spot.y+=lift*.09*scale;
    float radius=(.004*scale+.0005)*(1.+lift*1.4);
    float d=length(p-spot);
    float dotMask=1.0-smoothstep(radius,radius+.001,d);
    float shade=.45+.45*scale;
    vec3 ink=mix(vec3(.045,.12,.65)*shade,vec3(.12,.45,1.),min(1.,lift*1.2));
    c=mix(c,ink,dotMask*(.7+lift*.3));
  }
  gl_FragColor=vec4(c,1);
}
`

/**
 * Hive: a honeycomb whose cells are tinted by Subframe's slowly drifting contour terrain, from pale
 * wax up to golden honey. Each cell shimmers on its own, and cells near the mouse warm up.
 */
const HIVE_FRAGMENT = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_hover;
float terrain(vec2 p) {
  p += .045 * vec2(sin(u_time * .17), cos(u_time * .13));
  float a = exp(-dot(p - vec2(.22,.12), p - vec2(.22,.12)) * 4.0);
  float b = .72 * exp(-dot(p - vec2(-.4,-.2), p - vec2(-.4,-.2)) * 7.5);
  float valley = .37 * exp(-dot(p - vec2(-.02,-.25), p - vec2(-.02,-.25)) * 18.0);
  return a + b - valley + .027 * sin(p.x * 18.0 + sin(p.y * 12.0));
}
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.732))), p.x);
}
void main() {
  float unit = min(u_resolution.x, u_resolution.y);
  vec2 p = (gl_FragCoord.xy - .5 * u_resolution) / unit;
  // Honeycomb: find the nearest of two offset hexagon lattices.
  float cells = 11.0;
  vec2 uv = p * cells;
  vec2 r = vec2(1.0, 1.732);
  vec2 h = r * .5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = uv - gv;
  vec2 center = id / cells;
  float edge = .5 - hexDist(gv);
  float altitude = terrain(center * 1.6);
  float band = floor(altitude * 8.0) / 8.0;
  vec3 wax = vec3(.99, .95, .85);
  vec3 honey = vec3(.97, .77, .36);
  vec3 amber = vec3(.86, .55, .16);
  vec3 fill = mix(wax, honey, smoothstep(0.0, .9, band));
  fill = mix(fill, amber, smoothstep(.75, 1.25, band) * .7);
  float seed = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
  fill *= .975 + .025 * sin(u_time * .7 + seed * 6.283);
  fill = mix(fill * .97, fill, smoothstep(.04, .3, edge));
  vec2 m = (u_mouse - .5 * u_resolution) / unit;
  float md = length(center - m);
  float glow = u_hover * exp(-md * md * 45.0);
  float seam = 1.0 - smoothstep(.03, .03 + 2.0 * cells / unit, edge);
  vec3 color = mix(fill, vec3(1.0, .975, .92), seam * .9);
  // Wash towards warm wax so dark text reads on top of it.
  color = mix(color, vec3(.995, .965, .9), .42);
  // Cells under the mouse fill with warm honey (after the wash, so it shows).
  color = mix(color, vec3(.98, .72, .24), glow * (1.0 - seam) * .55);
  gl_FragColor = vec4(color, 1.0);
}
`

const SHADERS: Record<'aurora' | 'swell' | 'contour', { source: string; speed: number; start: number; maxPixels: number }> = {
  aurora: { source: AURORA_FRAGMENT, speed: 1, start: 3, maxPixels: 1_600_000 },
  swell: { source: SWELL_FRAGMENT, speed: 0.6, start: 3, maxPixels: 3_000_000 },
  contour: { source: HIVE_FRAGMENT, speed: 1, start: 3, maxPixels: 2_400_000 },
}

function startShader(canvas: HTMLCanvasElement, scene: keyof typeof SHADERS): SceneHandle | null {
  const { source, speed, start, maxPixels } = SHADERS[scene]
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  const free = () => {
    shaders.forEach(sh => gl.deleteShader(sh))
    gl.deleteProgram(program)
    gl.deleteBuffer(buffer)
  }
  const compile = (type: number, code: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    shaders.push(shader)
    gl.shaderSource(shader, code)
    gl.compileShader(shader)
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
  }
  const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 a_position; void main(){gl_Position=vec4(a_position,0.0,1.0);}')
  const fragment = compile(gl.FRAGMENT_SHADER, source)
  if (!vertex || !fragment || !program || !buffer) {
    free()
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    free()
    return null
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const resolutionU = gl.getUniformLocation(program, 'u_resolution')
  const timeU = gl.getUniformLocation(program, 'u_time')
  // Optional: only Swell and Hive declare these (a missing uniform is simply skipped).
  const mouseU = gl.getUniformLocation(program, 'u_mouse')
  const hoverU = gl.getUniformLocation(program, 'u_hover')
  // Mouse in canvas pixels (y up, as the shader sees it). It eases towards the pointer.
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, hover: 0, target: 0 }

  let time = start
  let raf = 0
  let last = 0
  let playing = false
  let stopped = false

  const draw = () => {
    if (stopped || gl.isContextLost()) return
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(resolutionU, canvas.width, canvas.height)
    gl.uniform1f(timeU, time)
    gl.uniform2f(mouseU, mouse.x, mouse.y)
    gl.uniform1f(hoverU, mouse.hover)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  // ~30fps is plenty for slow ambient motion and keeps the GPU (and battery) relaxed.
  const tick = (now: number) => {
    raf = 0
    if (stopped || !playing || document.hidden) {
      last = 0
      return
    }
    if (!last || now - last >= 32) {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0
      time += dt * speed
      const ease = 1 - Math.exp(-6 * dt)
      mouse.x += (mouse.tx - mouse.x) * ease
      mouse.y += (mouse.ty - mouse.y) * ease
      mouse.hover += (mouse.target - mouse.hover) * (1 - Math.exp(-3 * dt))
      last = now
      draw()
    }
    raf = requestAnimationFrame(tick)
  }
  const wake = () => {
    if (playing && !raf && !stopped && !document.hidden) raf = requestAnimationFrame(tick)
  }
  const toCanvas = (x: number, y: number) => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((x - rect.left) * canvas.width) / Math.max(1, rect.width),
      y: canvas.height - ((y - rect.top) * canvas.height) / Math.max(1, rect.height),
    }
  }
  const resize = () => {
    fitCanvas(canvas, maxPixels)
    draw()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  document.addEventListener('visibilitychange', wake)
  const lost = (e: Event) => {
    e.preventDefault()
    cancelAnimationFrame(raf)
    raf = 0
  }
  canvas.addEventListener('webglcontextlost', lost)
  resize()

  return {
    play(on) {
      playing = on
      if (on) wake()
      else {
        cancelAnimationFrame(raf)
        raf = 0
        last = 0
        // A still frame never shows a hover effect.
        mouse.hover = mouse.target = 0
        draw()
      }
    },
    point(pos) {
      if (!playing) return
      if (!pos) {
        mouse.target = 0
        return
      }
      const c = toCanvas(pos.x, pos.y)
      mouse.tx = c.x
      mouse.ty = c.y
      // First touch of the pointer: start the glow where it is rather than sliding in from a corner.
      if (mouse.hover < 0.01) {
        mouse.x = c.x
        mouse.y = c.y
      }
      mouse.target = 1
    },
    destroy() {
      stopped = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      document.removeEventListener('visibilitychange', wake)
      canvas.removeEventListener('webglcontextlost', lost)
      free()
    },
  }
}

/* ---------- Night sky: a few thin streaks of light crossing a quiet sky (CSS only) ---------- */

const METEORS = Array.from({ length: 12 }, (_, i) => ({
  left: `${8 + ((i * 31) % 100)}%`,
  top: `${-8 + ((i * 17) % 40)}%`,
  duration: `${7 + (i % 5) * 1.5}s`,
  delay: `${-i * 2.3}s`,
}))
const STARS = Array.from({ length: 40 }, (_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  top: `${(i * 53 + 7) % 100}%`,
  opacity: 0.25 + ((i * 7) % 5) * 0.08,
}))

function NightSky({ still }: { still: boolean }) {
  return (
    <div className="night-sky">
      {STARS.map((s, i) => (
        <i key={`s${i}`} className="night-star" style={{ left: s.left, top: s.top, opacity: s.opacity }} />
      ))}
      {!still &&
        METEORS.map((m, i) => (
          <span
            key={`m${i}`}
            className="night-meteor"
            style={{ left: m.left, top: m.top, animationDuration: m.duration, animationDelay: m.delay }}
          />
        ))}
    </div>
  )
}

/* ---------- The fixed layer behind the app ---------- */

export default function ThemeBackground() {
  const { scene, still } = useSceneState()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handle = useRef<SceneHandle | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    setFailed(false)
    if (!scene || !CANVAS_SCENES.includes(scene) || !canvas) return
    const h =
      scene === 'swarm'
        ? startSwarm(canvas)
        : scene === 'aurora' || scene === 'swell' || scene === 'contour'
          ? startShader(canvas, scene)
          : null
    if (!h) {
      setFailed(true)
      return
    }
    handle.current = h
    return () => {
      h.destroy()
      handle.current = null
    }
  }, [scene])

  useEffect(() => {
    handle.current?.play(!still)
  }, [still, scene])

  // Mouse effects (Swarm parallax, Swell ripple, Hive glow). The layer itself ignores the pointer so
  // it never blocks clicks; listen on the window instead. Off for touch and when motion is reduced.
  useEffect(() => {
    if (!scene || !POINTER_SCENES.includes(scene) || still) return
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      handle.current?.point?.({ x: e.clientX, y: e.clientY })
    }
    const out = (e: MouseEvent) => {
      if (!e.relatedTarget) handle.current?.point?.(null)
    }
    const blur = () => handle.current?.point?.(null)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('mouseout', out)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('mouseout', out)
      window.removeEventListener('blur', blur)
      handle.current?.point?.(null)
    }
  }, [scene, still])

  if (!scene) return null
  return (
    <div className={`theme-bg theme-bg-${scene}`} aria-hidden="true">
      {scene === 'nightsky' ? (
        <NightSky still={still} />
      ) : (
        // A canvas keeps one context type for life, so give each scene its own.
        <canvas key={scene} ref={canvasRef} style={{ visibility: failed ? 'hidden' : 'visible' }} />
      )}
    </div>
  )
}
