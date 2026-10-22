/**
 * Shared class names for the rowsquared look: square corners (the theme sets
 * every radius to 2px), flat panels with a hairline, colour-only hover and a
 * visible keyboard focus ring. Use these instead of repeating long class
 * strings; pass layout classes (width, margins) as `extra`.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

const buttonVariants: Record<ButtonVariant, string> = {
  accent: 'border border-indigo-300 bg-indigo-50 text-indigo-800 hover:border-indigo-600 hover:bg-indigo-100',
  primary: 'border border-indigo-600 bg-indigo-600 text-white hover:border-indigo-800 hover:bg-indigo-800',
  secondary: 'border border-gray-400 bg-white text-gray-900 hover:border-gray-900 hover:bg-gray-50',
  danger: 'border border-red-600 bg-red-600 text-white hover:border-red-800 hover:bg-red-800',
  ghost: 'border border-transparent text-gray-700 hover:bg-gray-100 hover:text-gray-900'
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm'
}

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = '') {
  return `${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]}${extra ? ` ${extra}` : ''}`
}

/** A static content panel: white, 1px hairline, no shadow. */
export const panelClass = 'bg-white border border-gray-200'

/** The floating box of a centred dialog (the overlay comes from Modal). */
export const dialogPanelClass = 'bg-white border border-gray-900 shadow-xl'

export type BadgeTone = 'plain' | 'neutral' | 'accent' | 'info' | 'warn' | 'danger' | 'solid'

const badgeTones: Record<BadgeTone, string> = {
  plain: '',
  neutral: 'bg-gray-100 text-gray-800',
  accent: 'bg-indigo-50 text-indigo-800',
  info: 'bg-[#E3EBFB] text-[#28498c]',
  warn: 'bg-[#F7F3B3] text-[#4d470b]',
  danger: 'bg-red-50 text-red-800',
  solid: 'bg-indigo-600 text-white'
}

/** Small square label: statuses, counts, roles. */
export function badgeClass(tone: BadgeTone = 'neutral', extra = '') {
  return `inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}${extra ? ` ${extra}` : ''}`
}
