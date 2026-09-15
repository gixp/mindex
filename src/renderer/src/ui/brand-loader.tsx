// The Mindex mark as a loader: the "M" inside a rounded-rectangle track with a
// segment travelling around it. Ported from the landing's account screen so the
// two places a user waits on Mindex look like the same product.
//
// Self-contained on purpose — the keyframes ship with the component rather than
// living in globals.css, so nothing about it can be broken from a distance.
const FRAME =
  'M224 14 H800 A210 210 0 0 1 1010 224 V800 A210 210 0 0 1 800 1010 H224 A210 210 0 0 1 14 800 V224 A210 210 0 0 1 224 14 Z'
const MARK = 'M 248 752 L 248 280 L 512 600 L 776 280 L 776 752'

// The app's accent, read from the same place every blue in the app is read
// from. It used to be a literal on the argument that an SVG stroke takes a
// colour rather than a class — which is true of the attribute, and not of the
// style property, where a custom property resolves like anywhere else. So the
// one blue that could not follow the theme now does.
const BRAND = 'hsl(var(--accent-1))'

export function BrandLoader({ size = 64 }: { size?: number }): JSX.Element {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="inline-block text-foreground"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 1024 1024" className="h-full w-full" fill="none">
        <g transform="translate(79.5 79.5) scale(0.845)">
          {/* The full track, faint — without it the moving segment reads as a
              stray line rather than progress around a shape. */}
          <path d={FRAME} stroke="currentColor" strokeOpacity={0.14} strokeWidth={28} />
          <path
            d={FRAME}
            stroke={BRAND}
            strokeWidth={28}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="70 30"
            className="mindex-brandloader"
          />
          <path
            d={MARK}
            stroke={BRAND}
            strokeWidth={84}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
      <style>{`
        @keyframes mindexBrandLoader { to { stroke-dashoffset: -100; } }
        .mindex-brandloader { animation: mindexBrandLoader 1.4s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .mindex-brandloader { animation: none; } }
      `}</style>
    </span>
  )
}
