/**
 * Animated backgrounds for the "Terraces" and "Swarm" themes.
 *
 * Adapted from Subframe's "Etched terraces" and "Paper swarm" motion examples.
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

type Scene = 'terraces' | 'swarm'
const SCENES: Scene[] = ['terraces', 'swarm']

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
  vec3 paper=mix(vec3(.98,.30,.07),vec3(.94,.96,.98),step(.52,edition));
  vec3 ink=vec3(.035,.08,.20);
  float margin=step(.12,uv.x)*step(uv.x,.88);
  float lines=step(.68,fract(uv.y*24.))*step(.12,uv.y)*step(uv.y,.42)*margin;
  float title=step(.61,uv.y)*step(uv.y,.83)*margin;
  float cut=step(.32,uv.x)*step(uv.x,.46);
  title*=1.-cut;
  float fold=smoothstep(.38,.5,uv.x)*.10-smoothstep(.5,.62,uv.x)*.10;
  vec3 paint=mix(paper,ink,max(lines,title));
  paint*=1.-fold;
  color=vec4(mix(paint,vec3(.025,.11,.37),depth*.50),1.);
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
  const COUNT = 150
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
  gl.clearColor(0.025, 0.11, 0.37, 1)

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
      time += dt * 0.6
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

/* ---------- The fixed layer behind the app ---------- */

export default function ThemeBackground() {
  const { scene, still } = useSceneState()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handle = useRef<SceneHandle | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    setFailed(false)
    if (!scene || !canvas) return
    const h = scene === 'terraces' ? startTerraces(canvas) : startSwarm(canvas)
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
      {/* A canvas keeps one context type for life, so give each scene its own. */}
      <canvas key={scene} ref={canvasRef} style={{ visibility: failed ? 'hidden' : 'visible' }} />
    </div>
  )
}
