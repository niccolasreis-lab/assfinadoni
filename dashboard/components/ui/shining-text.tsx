"use client"

import * as React from "react"
import { motion, useReducedMotion } from "motion/react"

export interface ShiningTextProps { text: string }

export function ShiningText({ text }: ShiningTextProps) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.h1
      className="bg-[linear-gradient(110deg,#cbd5e1,35%,#f3ce73,50%,#cbd5e1,75%,#cbd5e1)] bg-[length:200%_100%] bg-clip-text text-base font-normal text-transparent"
      initial={false}
      animate={reduceMotion ? { backgroundPosition: "0% 0" } : { backgroundPosition: ["200% 0", "-200% 0"] }}
      transition={{ repeat: reduceMotion ? 0 : Infinity, duration: 2, ease: "linear" }}
    >{text}</motion.h1>
  )
}
