export interface ShiningTextProps { text: string }

// A static loading label needs no animation runtime and never keeps a render loop alive.
export function ShiningText({ text }: ShiningTextProps) {
  return <h1 className="loading-label">{text}</h1>
}
