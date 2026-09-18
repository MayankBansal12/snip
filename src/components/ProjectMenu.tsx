import { useEffect, useRef } from 'react';
import { Keyboard, Moon, Plus, Sun, Trash2, X } from 'lucide-react';
type Props={open:boolean;theme:string;onClose:()=>void;onOpen:()=>void;onTheme:()=>void;onHelp:()=>void;onClear:()=>void};
export default function ProjectMenu(p:Props) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(p.open)ref.current?.showModal();else ref.current?.close();},[p.open]);
  const action=(callback:()=>void)=>{p.onClose();callback();};
  return <dialog ref={ref} className="project-dialog" aria-labelledby="project-title" onCancel={p.onClose} onClick={e=>{if(e.target===e.currentTarget)p.onClose();}}>
    <div className="dialog-heading"><h2 id="project-title">Your workspace</h2><button className="icon-button" aria-label="Close project menu" onClick={p.onClose} autoFocus><X size={18}/></button></div>
    <div className="project-actions">
      <button onClick={()=>action(p.onOpen)}><Plus size={18}/>New video</button>
      <button onClick={()=>action(p.onTheme)}>{p.theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}Switch to {p.theme==='dark'?'light':'dark'} mode</button>
      <button onClick={()=>action(p.onHelp)}><Keyboard size={18}/>Keyboard shortcuts</button>
      <button className="danger" onClick={()=>action(p.onClear)}><Trash2 size={18}/>Clear saved video</button>
    </div>
  </dialog>;
}
