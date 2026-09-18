import { createRoot } from "react-dom/client"
import { Demo } from "@/components/ui/demo"
import "@/styles/react.css"

const host = document.getElementById("initial-status")
if (host && !host.hidden) {
  const root = createRoot(host)
  root.render(<Demo />)
  const observer = new MutationObserver(() => {
    if (host.hidden) { root.unmount(); observer.disconnect() }
  })
  observer.observe(host, { attributes: true, attributeFilter: ["hidden"] })
}
