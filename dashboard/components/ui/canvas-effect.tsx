"use client"
import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function Dots() {
  const material = useRef<THREE.ShaderMaterial>(null)
  useFrame(({ clock }) => { if (material.current) material.current.uniforms.time.value = clock.elapsedTime })
  return <mesh><planeGeometry args={[2, 2]} /><shaderMaterial ref={material} transparent uniforms={{ time: { value: 0 } }} vertexShader={`varying vec2 pos;void main(){pos=uv;gl_Position=vec4(position,1.);}`} fragmentShader={`precision mediump float;varying vec2 pos;uniform float time;void main(){vec2 grid=fract(pos*vec2(65.,22.));float dotMask=1.-step(.1,length(grid-.5));float reveal=.3+.2*sin(time*.6+pos.x*5.);gl_FragColor=vec4(.486,.227,.929,dotMask*reveal);}`} /></mesh>
}

// Decorative only: the chat remains fully functional without WebGL or animation.
export function CanvasRevealEffect() {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { try { setEnabled(!preference.matches && Boolean(document.createElement('canvas').getContext('webgl2'))) } catch { setEnabled(false) } }
    update(); preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  return enabled ? <div className="assistant-canvas" aria-hidden="true"><Canvas dpr={1} fallback={<span />}><Dots /></Canvas></div> : null
}
