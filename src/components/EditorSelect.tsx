import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from './ui/select';
type Props = { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; className?: string };
/** Shared composition of the standard coss select; no custom control styling. */
export default function EditorSelect({ label, value, options, onChange, className }: Props) {
  return <Select items={options} value={value} onValueChange={next => { if (next !== null) onChange(next); }}>
    <SelectTrigger aria-labelledby="" aria-label={label} className={className}><SelectValue /></SelectTrigger>
    <SelectPopup alignItemWithTrigger={false}>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectPopup>
  </Select>;
}
