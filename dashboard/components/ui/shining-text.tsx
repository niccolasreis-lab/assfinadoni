"use client"

import * as React from "react"
import { motion, useReducedMotion } from "motion/react"

export interface ShiningTextProps { text: string }

export function ShiningText({ text }: ShiningTextProps) {
  const systemReduced = useReducedMotion()
  const [enabled, setEnabled] = React.useState(false)
  React.useEffect(() => {
    const update = () => {
      try { setEnabled(document.documentElement.dataset.motion !== 'off' && localStorage.getItem('finance_motion_v1') !== 'off') }
      catch { setEnabled(document.documentElement.dataset.motion !== 'off') }
    }
    update(); window.addEventListener('finance:motion', update)
    return () => window.removeEventListener('finance:motion', update)
  }, [])
  const reduceMotion = systemReduced || !enabled
  return (
    <motion.h1
      className="bg-[linear-gradient(110deg,#cbd5e1,35%,#f3ce73,50%,#cbd5e1,75%,#cbd5e1)] bg-[length:200%_100%] bg-clip-text text-base font-normal text-transparent"
      initial={false}
      animate={reduceMotion ? { backgroundPosition: "0% 0" } : { backgroundPosition: ["200% 0", "-200% 0"] }}
      transition={{ repeat: reduceMotion ? 0 : Infinity, duration: 2, ease: "linear" }}
    >{text}</motion.h1>
  )
}
