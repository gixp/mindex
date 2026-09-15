import { forwardRef } from 'react'
import type { CSSProperties, HTMLAttributes } from 'react'
import { cn } from '@/ui/cn'

export interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  name: string
  size?: number
}

export const Icon = forwardRef<HTMLSpanElement, IconProps>(function Icon(
  { name, size, className, style, ...rest },
  ref
): JSX.Element {
  const merged: CSSProperties | undefined = size != null ? { fontSize: size, ...style } : style
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn('codicon', `codicon-${name}`, className)}
      style={merged}
      {...rest}
    />
  )
})
