import type { SVGProps } from 'react'
import { cn } from '@/ui/cn'

interface Props extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number
}

export function LayoutCenteredOffIcon({ size = 16, className, ...rest }: Props): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={cn('codicon', className)}
      stroke="currentColor"
      aria-hidden="true"
      {...rest}
    >
      <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" strokeWidth="1" />
      <line x1="6" y1="2" x2="6" y2="14" strokeWidth="1" />
      <line x1="10" y1="2" x2="10" y2="14" strokeWidth="1" />
    </svg>
  )
}
