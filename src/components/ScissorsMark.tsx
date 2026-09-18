export default function ScissorsMark({className}:{className?:string}) {
  return <svg className={className} width="92" height="64" viewBox="0 0 92 64" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3.5 4">
      <path d="M28 25c-7 2-15-1-16-7C10 9 18 5 24 9c5 3 7 9 4 16Z"/>
      <path d="M28 39c-7-2-15 1-16 7-2 9 6 13 12 9 5-3 7-9 4-16Z"/>
      <path d="m28 25 43 29M28 39 71 10"/>
    </g>
    <circle cx="39" cy="32" r="2" fill="currentColor"/>
    <path d="M55 32h27" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 5" opacity=".45"/>
  </svg>;
}
