import { Button, type ButtonProps } from './ui/button';
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/tooltip';
export default function IconButton({ label, children, ...props }: ButtonProps & { label: string }) {
  return <Tooltip><TooltipTrigger render={<Button size="icon" variant="ghost" aria-label={label} {...props} />}>{children}</TooltipTrigger><TooltipPopup>{label}</TooltipPopup></Tooltip>;
}
