'use client'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import ReactMarkdown from 'react-markdown'

interface TooltipProps {
  content: string
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  delayDuration?: number
}

export default function Tooltip({ content, children, side = 'top', delayDuration = 1000 }: TooltipProps) {
  if (!content || content.trim() === '') {
    return <>{children}</>
  }

  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={8}
            className="z-50 max-w-sm bg-black text-white text-sm shadow-lg p-3"
          >
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                  li: ({ children }) => <li className="text-sm">{children}</li>,
                  code: ({ children }) => (
                    <code className="bg-gray-800 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
                  ),
                  a: ({ children, href }) => (
                    <a
                      href={href}
                      className="text-white underline underline-offset-2 hover:text-indigo-200"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  )
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
            <TooltipPrimitive.Arrow className="fill-gray-900" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
