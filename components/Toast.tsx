'use client'

import { useEffect } from 'react'
import { X, CheckCircle2, XCircle, Info } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'info'

export type Toast = {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastProps {
  toast: Toast
  onClose: (id: string) => void
}

export function ToastItem({ toast, onClose }: ToastProps) {
  useEffect(() => {
    const duration = toast.duration ?? 5000
    const timer = setTimeout(() => {
      onClose(toast.id)
    }, duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onClose])

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-indigo-600" />
      case 'error':
        return <XCircle className="w-5 h-5 text-red-600" />
      case 'info':
        return <Info className="w-5 h-5 text-gray-700" />
    }
  }

  const getStyles = () => {
    switch (toast.type) {
      case 'success':
        return 'border-t-indigo-600'
      case 'error':
        return 'border-t-red-600'
      case 'info':
        return 'border-t-gray-900'
    }
  }

  return (
    <div
      className={`${getStyles()} bg-white text-gray-900 border border-gray-200 border-t-2 shadow-lg p-4 flex items-start gap-3 min-w-[300px] max-w-[500px] animate-fade-in`}
    >
      {getIcon()}
      <div className="flex-1 text-sm">{toast.message}</div>
      <button
        onClick={() => onClose(toast.id)}
        aria-label="Dismiss notification"
        className="text-gray-600 hover:text-gray-900 transition-colors flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

interface ToastContainerProps {
  toasts: Toast[]
  onClose: (id: string) => void
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  )
}
