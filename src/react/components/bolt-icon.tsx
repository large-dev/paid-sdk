import { BOLT_CLIP_PATH } from '../../core/types'

const sizes = {
  sm: { width: 14, height: 14 },
  md: { width: 32, height: 32 },
  lg: { width: 48, height: 48 },
} as const

export interface BoltIconProps {
  size?: keyof typeof sizes
  color?: 'black' | 'white'
  className?: string
}

export function BoltIcon({ size = 'md', color = 'black', className = '' }: BoltIconProps) {
  const dims = sizes[size]
  return (
    <div
      className={className}
      style={{
        width: dims.width,
        height: dims.height,
        backgroundColor: color,
        clipPath: BOLT_CLIP_PATH,
        flexShrink: 0,
      }}
    />
  )
}
