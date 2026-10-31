/**
 * Animated backgrounds for the motion themes.
 *
 * Adapted from Subframe Motion Library examples: "Etched terraces", "Paper swarm", "Aurora curtain",
 * "Point cloud wave", "Contour terrain" and "Meteors". Colours and speeds are toned down so the
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

type Scene = 'terraces' | 'swarm' | 'aurora' | 'swell' | 'contour' | 'nightsky'
const SCENES: Scene[] = ['terraces', 'swarm', 'aurora', 'swell', 'contour', 'nightsky']
const CANVAS_SCENES: Scene[] = ['terraces', 'swarm', 'aurora', 'swell', 'contour']

/** A running scene. `play` starts or stops the motion; when stopped it shows a still frame. */
interface SceneHandle {
  play: (on: boolean) => void
  /** Pointer position from -0.5..0.5, for scenes that react to it. */
  point?: (x: number, y: number) => void
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

/* ---------- Etched terraces: two stepped reliefs drawn from fine cyan scanlines ---------- */

function startTerraces(canvas: HTMLCanvasElement): SceneHandle | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  let width = 0
  let height = 0
  let time = 0
  let raf = 0
  let last = 0
  let playing = false
  const relief = 65

  const draw = () => {
    if (!width || !height) return
    ctx.fillStyle = '#e31b32'
    ctx.fillRect(0, 0, width, height)
    // Scale the relief with the screen so it reads the same on a phone and a big monitor.
    const lift = relief * 0.9 * Math.max(0.7, Math.min(2.2, height / 420))
    const field = (x: number, y: number) => {
      let z = 0
      for (let k = 0; k < 2; k++) {
        const cx = width * (0.32 + k * 0.37)
        const cy = height * (0.53 - k * 0.1)
        const angle = (k ? -0.27 : 0.16) + Math.sin(time * 0.16) * 0.09
        const dx = x - cx
        const dy = y - cy
        const a = (dx * Math.cos(angle) - dy * Math.sin(angle)) / (width * 0.255)
        const b = (dx * Math.sin(angle) + dy * Math.cos(angle)) / (height * 0.37)
        const d = Math.max(Math.abs(a), Math.abs(b))
        if (d < 1) {
          const steps = (1 - d) * 8
          const t = steps % 1
          const ledge = Math.floor(steps) + (t < 0.2 ? ((t * t) / 0.04) * 0.13 : 0.13 + ((t - 0.2) * 0.87) / 0.8)
          z += (ledge / 8) * lift
        }
      }
      return z
    }
    // Fewer, slightly wider-spaced lines than the original: it fills the whole screen here.
    const lineGap = Math.max(2.6, height / 260)
    const xStep = Math.max(3.5, width / 340)
    const x0 = width * 0.04
    const x1 = width * 0.96
    const y0 = height * 0.1
    const y1 = height * 0.97
    ctx.strokeStyle = '#5ce4ec'
    ctx.lineWidth = 0.72
    for (let y = y0; y < y1; y += lineGap) {
      ctx.beginPath()
      for (let x = x0; x <= x1; x += xStep) {
        const z = field(x, y)
        const v = y - z + Math.sin(x * 0.07 + time * 0.7) * z * 0.045
        if (x === x0) ctx.moveTo(x, v)
        else ctx.lineTo(x, v)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 0.25
    for (let x = x0; x < x1; x += xStep * 2.6) {
      ctx.beginPath()
      for (let y = y0; y < y1; y += 4) {
        const z = field(x, y)
        if (y === y0) ctx.moveTo(x, y - z)
        else ctx.lineTo(x, y - z)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  const resize = () => {
    const { cssW, cssH } = fitCanvas(canvas, 4_000_000)
    width = cssW
    height = cssH
    ctx.setTransform(canvas.width / Math.max(1, width), 0, 0, canvas.height / Math.max(1, height), 0, 0)
    draw()
  }

  // A background doesn't need 120fps: ~30fps keeps it smooth and light on the battery.
  const tick = (now: number) => {
    raf = 0
    if (!playing || document.hidden) {
      last = 0
      return
    }
    if (!last || now - last >= 32) {
      if (last) time += Math.min((now - last) / 1000, 0.05)
      last = now
      draw()
    }
    raf = requestAnimationFrame(tick)
  }
  const wake = () => {
    if (playing && !raf && !document.hidden) raf = requestAnimationFrame(tick)
  }

  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  document.addEventListener('visibilitychange', wake)
  resize()

  return {
    play(on) {
      playing = on
      if (on) wake()
      else {
        cancelAnimationFrame(raf)
        raf = 0
        last = 0
        draw()
      }
    },
    destroy() {
      playing = false
      cancelAnimationFrame(raf)
      observer.disconnect()
      document.removeEventListener('visibilitychange', wake)
    },
  }
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
    point(x, y) {
      if (!playing) return
      targetX = x * 0.3
      targetY = y * 0.15
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

/* ---------- Full-screen shader scenes (WebGL1): Aurora, Swell, Contour ---------- */

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

/** Point cloud wave: rows of small ultramarine dots swelling slowly on pale grey. */
const SWELL_FRAGMENT = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
void main() {
  vec2 p=(gl_FragCoord.xy-.5*u_resolution)/min(u_resolution.x,u_resolution.y);
  vec3 c=vec3(.90,.92,.94);
  for(int i=0;i<30;i++) {
    float row=float(i);
    float z=.45+row*.052;
    float scale=1.0/(1.0+z);
    float xCell=floor(p.x/scale*28.0+.5);
    float x=xCell/28.0;
    float height=sin(x*5.0+z*4.0-u_time*.48)*.1+.04*cos(x*9.0-z*3.0);
    vec2 spot=vec2(x*scale,(.3-z*.31+height)*scale);
    float radius=.004*scale+.0005;
    float d=length(p-spot);
    float dotMask=1.0-smoothstep(radius,radius+.001,d);
    float shade=.45+.45*scale;
    c=mix(c,vec3(.045,.12,.65)*shade,dotMask*.8);
  }
  gl_FragColor=vec4(c,1);
}
`

/** Contour terrain: drifting elevation bands, softened to a pale sand map with peach contours. */
const CONTOUR_FRAGMENT = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
float terrain(vec2 p) {
  p += .045 * vec2(sin(u_time * .17), cos(u_time * .13));
  float a = exp(-dot(p - vec2(.22,.12), p - vec2(.22,.12)) * 4.0);
  float b = .72 * exp(-dot(p - vec2(-.4,-.2), p - vec2(-.4,-.2)) * 7.5);
  float valley = .37 * exp(-dot(p - vec2(-.02,-.25), p - vec2(-.02,-.25)) * 18.0);
  return a + b - valley + .027 * sin(p.x * 18.0 + sin(p.y * 12.0));
}
void main() {
  vec2 p = (gl_FragCoord.xy - .5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  float altitude = terrain(p * 1.6);
  float band = floor(altitude * 15.0) / 15.0;
  float edge = fract(altitude * 15.0);
  float contour = 1.0 - smoothstep(.024, .115, min(edge, 1.0 - edge));
  float shade = smoothstep(.06, .19, edge) * (1.0 - smoothstep(.84,.98,edge));
  vec3 orange = vec3(.76,.205,.062);
  vec3 sand = vec3(.98,.87,.63);
  vec3 color = mix(orange, sand, clamp(band * .78, 0.0, .9));
  color *= .9 + .1 * shade;
  color = mix(color, vec3(.99,.92,.75), contour * .78);
  vec2 marks = abs(fract(p * 5.0 + .5) - .5);
  float cross = (1.0 - smoothstep(.005,.011,marks.x)) * (1.0 - smoothstep(.035,.04,marks.y));
  cross = max(cross, (1.0 - smoothstep(.005,.011,marks.y)) * (1.0 - smoothstep(.035,.04,marks.x)));
  color = mix(color, vec3(.44,.11,.045), cross * .35);
  // Wash towards warm paper so dark text reads on top of it.
  color = mix(color, vec3(.985,.945,.88), .64);
  gl_FragColor = vec4(color, 1.0);
}
`

const SHADERS: Record<'aurora' | 'swell' | 'contour', { source: string; speed: number; start: number; maxPixels: number }> = {
  aurora: { source: AURORA_FRAGMENT, speed: 1, start: 3, maxPixels: 1_600_000 },
  swell: { source: SWELL_FRAGMENT, speed: 0.6, start: 3, maxPixels: 3_000_000 },
  contour: { source: CONTOUR_FRAGMENT, speed: 1, start: 3, maxPixels: 1_600_000 },
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
      if (last) time += Math.min((now - last) / 1000, 0.05) * speed
      last = now
      draw()
    }
    raf = requestAnimationFrame(tick)
  }
  const wake = () => {
    if (playing && !raf && !stopped && !document.hidden) raf = requestAnimationFrame(tick)
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
        draw()
      }
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
      scene === 'terraces'
        ? startTerraces(canvas)
        : scene === 'swarm'
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

  // Gentle parallax for the swarm. The layer itself ignores the pointer, so listen on the window.
  useEffect(() => {
    if (scene !== 'swarm' || still) return
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      handle.current?.point?.(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5)
    }
    const leave = () => handle.current?.point?.(0, 0)
    window.addEventListener('pointermove', move)
    document.addEventListener('pointerleave', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
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
