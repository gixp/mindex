import * as React from 'react'
import { cn } from '@/ui/cn'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type ?? 'text'}
      ref={ref}
      className={cn(
        'flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-sm shadow-none transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
