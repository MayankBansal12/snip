export default function ScissorsMark({className}:{className?:string}) {
  return <svg className={className} width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="15" r="7"/>
      <circle cx="12" cy="49" r="7"/>
      <path d="m17.5 19.5 34 28.5M17.5 44.5 51.5 16"/>
      <path d="M44 32h16" strokeWidth="2" strokeDasharray="2 5"/>
    </g>
    <circle cx="32.5" cy="32" r="2.3" fill="currentColor"/>
  </svg>;
}
