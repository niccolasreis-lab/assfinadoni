import { useEffect, useRef, useState, lazy, Suspense, Component, type ReactNode } from 'react'
import { MessageCircle, Mic, Square, Paperclip, Send, X, Trash2, Pencil } from 'lucide-react'
const CanvasRevealEffect = lazy(() => import('./canvas-effect').then(m => ({ default: m.CanvasRevealEffect })))
type Transaction = { id?: string; description: string; amount: number; transaction_date: string; deleted_at?: string }
type Job = { id: string; status: string; result?: { text: string; transcript?: string; transactions?: Transaction[]; confirmation_id?: string; changed?: boolean } }
type Props = { reload: () => void }
const MAX_FILE = 3 * 1024 * 1024
class DecorationBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}; static getDerivedStateFromError(){return {failed:true}}; render(){return this.state.failed?null:this.props.children}
}
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Não consegui concluir. Tente novamente.')
  return data
}
const base64 = (file: File) => new Promise<string>((resolve,reject) => { const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=reject; reader.readAsDataURL(file) })

export function AssistantPanel({reload}:Props) {
  const [open,setOpen]=useState(false),[text,setText]=useState(''),[file,setFile]=useState<File|null>(null)
  const [jobs,setJobs]=useState<Job[]>([]),[error,setError]=useState(''),[sending,setSending]=useState(false),[recording,setRecording]=useState(false),[seconds,setSeconds]=useState(0)
  const [preview,setPreview]=useState(''),[retry,setRetry]=useState<{request_id:string;text:string;file?:{name:string;base64:string};action?:string;confirmation_id?:string}|null>(null)
  const dialog=useRef<HTMLDialogElement>(null), input=useRef<HTMLTextAreaElement>(null), picker=useRef<HTMLInputElement>(null), opener=useRef<HTMLButtonElement>(null)
  const recorder=useRef<MediaRecorder|null>(null), stream=useRef<MediaStream|null>(null), timer=useRef<ReturnType<typeof setInterval>|null>(null)
  const abort=useRef(new AbortController()), changed=useRef(new Set<string>()), alive=useRef(true), discard=useRef(false)
  const busy=jobs.some(j=>['queued','processing'].includes(j.status))
  function stop() { if(timer.current) clearInterval(timer.current); timer.current=null; if(recorder.current?.state==='recording') recorder.current.stop(); stream.current?.getTracks().forEach(t=>t.stop()); stream.current=null }
  useEffect(()=>()=>{alive.current=false;discard.current=true;stop();abort.current.abort()},[])
  useEffect(()=>{if(!file || !file.type.startsWith('audio/')) {setPreview('');return};const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file])
  useEffect(()=>{
    if(open) dialog.current?.showModal(); else {dialog.current?.close();discard.current=true;stop()}
  },[open])
  function merge(incoming:Job[]) {
    setJobs(old=>{const map=new Map(old.map(j=>[j.id,j]));incoming.forEach(j=>map.set(j.id,j));return [...map.values()].slice(-16)})
    for(const job of incoming) if(job.result?.changed&&!changed.current.has(job.id)){changed.current.add(job.id);reload()}
  }
  useEffect(()=>{
    if(!open) return
    let active=true, timeout:ReturnType<typeof setTimeout>
    const poll=async()=>{try{const data=await request('/api/assistant',undefined,abort.current.signal);if(active){setError('');merge(data.jobs)}}catch(e){if(active)setError((e as Error).message)}finally{if(active)timeout=setTimeout(poll,2500)}}
    void poll();return()=>{active=false;clearTimeout(timeout)}
  },[open])
  function selectFile(f?:File){setError('');setRetry(null);if(!f)return;if(f.size>MAX_FILE){setError('O arquivo deve ter no máximo 3 MB.');return}if(!/\.pdf$/i.test(f.name)){setError('Anexe um PDF. Para áudio, use o microfone.');return}setFile(f)}
  async function record(){
    setError('');setRetry(null);discard.current=false
    try {
      if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Este navegador não permite gravar. Use texto ou grave pelo Telegram.')
      const media=await navigator.mediaDevices.getUserMedia({audio:true});if(!alive.current||!dialog.current?.open){media.getTracks().forEach(t=>t.stop());return}
      stream.current=media
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type))
      const rec=new MediaRecorder(media,mime?{mimeType:mime}:undefined);recorder.current=rec
      const chunks:BlobPart[]=[];let size=0;let elapsed=0
      rec.ondataavailable=e=>{chunks.push(e.data);size+=e.data.size;if(size>MAX_FILE){discard.current=true;stop();if(alive.current)setError('Gravação maior que 3 MB. Grave um áudio menor.')}}
      rec.onstop=()=>{if(!alive.current)return;setRecording(false);if(!discard.current){const ext=rec.mimeType.includes('mp4')?'m4a':rec.mimeType.includes('ogg')?'ogg':'webm';setFile(new File(chunks,`Mensagem.${ext}`,{type:rec.mimeType}))}}
      rec.onerror=()=>{discard.current=true;stop();setRecording(false);setError('Não consegui gravar. Tente novamente ou use texto.')}
      rec.start(1000);setRecording(true);setSeconds(0)
      timer.current=setInterval(()=>{elapsed++;setSeconds(elapsed);if(elapsed>=120)stop()},1000)
    }catch{setError('Não consegui acessar o microfone. Confira a permissão ou use texto.')}
  }
  async function send(action?:string,confirmationId?:string){
    if(sending||recording)return;setSending(true);setError('')
    try {
      const payload=action?{request_id:crypto.randomUUID(),text:'',action,confirmation_id:confirmationId}:retry||{request_id:crypto.randomUUID(),text,...(file?{file:{name:file.name,base64:await base64(file)}}:{})}
      setRetry(payload);const job=await request('/api/assistant',payload,abort.current.signal)
      if(!alive.current)return;merge([job]);setRetry(null);setText('');setFile(null)
    }catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setSending(false)}
  }
  return <><button ref={opener} className="assistant-launch" onClick={()=>setOpen(true)} aria-haspopup="dialog"><MessageCircle size={20}/>Assistente IA</button>
    <dialog ref={dialog} className="assistant-panel" aria-labelledby="assistant-title" onCancel={()=>setOpen(false)} onClose={()=>{setOpen(false);opener.current?.focus()}}>
      <header><div><h2 id="assistant-title">Assistente IA</h2><p>Texto, áudio ou PDF. Seu financeiro, em conversa.</p></div><button aria-label="Fechar assistente" className="assistant-icon" onClick={()=>setOpen(false)}><X/></button></header>
      <div className="assistant-messages" role="log" aria-live="polite" aria-relevant="additions text">
        {!jobs.length&&<div className="assistant-empty"><DecorationBoundary><Suspense fallback={null}>{open&&<CanvasRevealEffect/>}</Suspense></DecorationBoundary><h3>O que vamos registrar?</h3><p>“Gastei R$ 45 no almoço” ou “Recebi meu salário”. Você também pode enviar um recibo.</p><small>A conversa acompanha sua conta no Telegram.</small></div>}
        {jobs.map(job=><article key={job.id} className="assistant-message">
          {job.result?.transcript&&<details><summary>O que entendi do anexo</summary><p>{job.result.transcript}</p></details>}
          <p>{job.result?.text||(job.status==='queued'?'Na fila…':'Conferindo seu pedido…')}</p>
          {job.result?.transactions?.map((t,index)=><div className="assistant-receipt" key={t.id||index}><strong>{t.description}</strong><span>{Number(t.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} · {t.transaction_date?.split('-').reverse().join('/')}</span>
            {t.id&&!t.deleted_at&&job.status==='done'&&<div className="assistant-actions"><button onClick={()=>{setRetry(null);setText(`Altere o lançamento ${t.id}: `);input.current?.focus()}}><Pencil size={15}/>Alterar</button><button disabled={sending||busy} onClick={()=>{setRetry(null);setText(`Exclua o lançamento ${t.id}`);input.current?.focus()}}><Trash2 size={15}/>Excluir</button></div>}</div>)}
          {job.status==='awaiting_confirmation'&&job.result?.confirmation_id&&<div className="assistant-actions"><button disabled={sending||busy} onClick={()=>send('confirm',job.result?.confirmation_id)}>Confirmar</button><button disabled={sending||busy} onClick={()=>send('cancel',job.result?.confirmation_id)}>Cancelar</button></div>}
        </article>)}
      </div>
      <form className="assistant-compose" onSubmit={e=>{e.preventDefault();void send()}}>
        {file&&<div className="assistant-file"><span>{file.name}</span><button type="button" className="assistant-icon" aria-label="Descartar anexo" onClick={()=>{setRetry(null);setFile(null)}}><X size={18}/></button>{preview&&<audio controls src={preview} preload="metadata"/>}</div>}
        {recording&&<p role="status">Gravando · {seconds}s / 120s <button type="button" onClick={()=>{discard.current=true;stop()}}>Descartar</button></p>}
        {error&&<p className="assistant-error" role="alert">{error}</p>}
        <label htmlFor="assistant-message">Sua mensagem</label><textarea id="assistant-message" ref={input} value={text} maxLength={4000} rows={2} placeholder="Conte o que aconteceu…" onChange={e=>{setRetry(null);setText(e.target.value)}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!busy&&(text.trim()||file))void send()}}}/>
        <div className="assistant-compose-actions"><input hidden ref={picker} type="file" accept=".pdf,application/pdf" onChange={e=>{selectFile(e.target.files?.[0]);e.target.value=''}}/>
          <button type="button" disabled={sending||recording} onClick={()=>picker.current?.click()}><Paperclip size={18}/>PDF</button>
          <button type="button" disabled={sending} onClick={()=>recording?stop():void record()} aria-label={recording?'Parar gravação':'Gravar áudio'}>{recording?<Square size={18}/>:<Mic size={18}/>}</button>
          <button type="submit" className="assistant-send" disabled={sending||busy||recording||(!text.trim()&&!file&&!retry)}><Send size={18}/>{sending?'Enviando…':retry?'Tentar novamente':'Enviar'}</button>
        </div><small>Áudio: 2 min · PDF: 10 páginas · Até 3 MB</small>
      </form>
    </dialog></>
}
