import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"

export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: {
    outDir: "dist", emptyOutDir: true, minify: true,
    lib: { entry: "components/loading-island.tsx", formats: ["es"], fileName: "loading-island", cssFileName: "react" },
  },
})
