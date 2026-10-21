'use client'
import { useState, useRef, useEffect, ReactNode } from 'react'

interface ResizablePanelProps {
  children: ReactNode
  defaultWidth?: number // percentage
  minWidth?: number // percentage
  maxWidth?: number // percentage
  side?: 'left' | 'right'
  className?: string
  style?: React.CSSProperties
  storageKey?: string
}

export default function ResizablePanel({
  children,
  defaultWidth = 50,
  minWidth = 30,
  maxWidth = 70,
  side = 'right',
  className = '',
  style = {},
  storageKey
}: ResizablePanelProps) {
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return defaultWidth
    if (storageKey) {
      const stored = window.localStorage.getItem(storageKey)
      if (stored) {
        const parsed = parseFloat(stored)
        if (!Number.isNaN(parsed)) {
          return Math.max(minWidth, Math.min(maxWidth, parsed))
        }
      }
    }
    return defaultWidth
  })
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return

      const container = panelRef.current.parentElement
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const containerWidth = containerRect.width

      let newWidth: number
      if (side === 'right') {
        // Calculate from right edge
        const mouseX = e.clientX - containerRect.left
        newWidth = ((containerWidth - mouseX) / containerWidth) * 100
      } else {
        // Calculate from left edge
        const mouseX = e.clientX - containerRect.left
        newWidth = (mouseX / containerWidth) * 100
      }

      // Clamp to min/max
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      // Prevent text selection while resizing
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, side, minWidth, maxWidth])

  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, String(width))
    }
  }, [width, storageKey])

  return (
    <div ref={panelRef} className={`relative ${className}`} style={{ width: `${width}%`, flexShrink: 0, ...style }}>
      {/* Resize Handle */}
      <div
        onMouseDown={() => setIsResizing(true)}
        className={`absolute top-0 bottom-0 w-1 hover:w-1.5 bg-transparent hover:bg-indigo-400 cursor-ew-resize transition-all z-50 ${
          side === 'right' ? '-left-0.5' : '-right-0.5'
        } ${isResizing ? 'w-1.5 bg-indigo-500' : ''}`}
        style={{
          [side === 'right' ? 'left' : 'right']: 0
        }}
      />

      {children}
    </div>
  )
}
