import { createRoot } from "react-dom/client"
import { Demo } from "@/components/ui/demo"
import "@/styles/react.css"
import { AssistantPanel } from './ui/assistant-panel'

const dashboard = document.getElementById('dashboard-view')
if (dashboard) {
  const mount = document.createElement('div')
  dashboard.append(mount)
  let root: ReturnType<typeof createRoot> | null = null
  const sync = () => {
    if (dashboard.hidden) { root?.unmount(); root = null }
    else if (!root) { root = createRoot(mount); root.render(<AssistantPanel reload={() => window.dispatchEvent(new Event('finance-assistant-changed'))} />) }
  }
  new MutationObserver(sync).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] })
  sync()
}

const host = document.getElementById("initial-status")
if (host && !host.hidden) {
  const root = createRoot(host)
  root.render(<Demo />)
  const observer = new MutationObserver(() => {
    if (host.hidden) { root.unmount(); observer.disconnect() }
  })
  observer.observe(host, { attributes: true, attributeFilter: ["hidden"] })
}
