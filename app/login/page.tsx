'use client'

import { useState } from 'react'
import { signInWithIdentifier } from '@/lib/auth-client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error: signInError } = await signInWithIdentifier(email, password)

      if (signInError) {
        setError(signInError.status === 429
          ? 'Too many sign-in attempts. Please wait a minute and try again.'
          : 'Invalid email or password')
        setLoading(false)
        return
      }

      router.push('/')
      router.refresh()
    } catch (error) {
      console.error('Login error:', error)
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex">
      {/* Left Panel - Hierarchical Classification Tree */}
      <div className="hidden lg:flex lg:flex-1 lg:w-[60%] bg-gradient-to-br from-indigo-400 via-indigo-500 to-indigo-600 relative overflow-hidden flex-col items-center justify-center p-12">
        {/* Hierarchical Tree Visualization */}
        <div className="relative w-full max-w-2xl mb-8">
          <svg viewBox="0 0 600 380" className="w-full h-auto">
            <defs>
              {/* Glow effect for highlighted path */}
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              
              {/* Animated path highlight - all elements in a path highlight together */}
              <style>{`
                @keyframes pathPulse {
                  0%, 100% { opacity: 0.35; }
                  50% { opacity: 0.8; }
                }
                .path-line-1, .path-node-1 {
                  animation: pathPulse 12s ease-in-out infinite;
                  animation-delay: 0s;
                }
                .path-line-2, .path-node-2 {
                  animation: pathPulse 12s ease-in-out infinite;
                  animation-delay: 4s;
                }
                .path-line-3, .path-node-3 {
                  animation: pathPulse 12s ease-in-out infinite;
                  animation-delay: 8s;
                }
                
                /* Icon animations - subtle scale and color sync with paths */
                @keyframes iconScale {
                  0%, 100% { transform: scale(1); }
                  50% { transform: scale(1.08); }
                }
                @keyframes iconColorPulse1 {
                  0%, 100% { stroke: rgba(255, 255, 255, 0.7); }
                  0%, 33% { stroke: rgba(255, 255, 255, 0.95); }
                  34%, 100% { stroke: rgba(255, 255, 255, 0.7); }
                }
                @keyframes iconColorPulse2 {
                  0%, 33% { stroke: rgba(255, 255, 255, 0.7); }
                  34%, 66% { stroke: rgba(255, 255, 255, 0.95); }
                  67%, 100% { stroke: rgba(255, 255, 255, 0.7); }
                }
                @keyframes iconColorPulse3 {
                  0%, 66% { stroke: rgba(255, 255, 255, 0.7); }
                  67%, 100% { stroke: rgba(255, 255, 255, 0.95); }
                }
            .brain-icon {
              animation: iconScale 4s ease-in-out infinite;
              margin-bottom: 32px;
            }
            .chip-icon {
              animation: iconScale 4s ease-in-out infinite 2s;
              margin-bottom: 32px;
            }
                .brain-icon-svg {
                  animation: iconColorPulse1 12s ease-in-out infinite;
                }
                .chip-icon-svg {
                  animation: iconColorPulse3 12s ease-in-out infinite;
                }
              `}</style>
            </defs>
            
            {/* Root Level - Brain/AI Split using Lucide icons */}
            <g transform="translate(300, 80)">
              {/* Left side - Brain icon (white, larger, further from tree) */}
              <foreignObject x="-80" y="-35" width="64" height="64">
                <div className="flex items-center justify-center w-full h-full brain-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="brain-icon-svg">
                    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
                    <path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>
                    <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>
                    <path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>
                    <path d="M19.938 10.5a4 4 0 0 1 .585.396"/>
                    <path d="M6 18a4 4 0 0 1-1.967-.516"/>
                    <path d="M19.967 17.484A4 4 0 0 1 18 18"/>
                  </svg>
                </div>
              </foreignObject>
              
              {/* Right side - Chip/CPU icon (white, larger, further from tree) */}
              <foreignObject x="20" y="-35" width="64" height="64">
                <div className="flex items-center justify-center w-full h-full chip-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="chip-icon-svg">
                    <rect width="14" height="14" x="5" y="5" rx="2"/>
                    <rect width="6" height="6" x="9" y="9" rx="1"/>
                    <path d="M15 2v2"/>
                    <path d="M15 20v2"/>
                    <path d="M2 15h2"/>
                    <path d="M2 9h2"/>
                    <path d="M20 15h2"/>
                    <path d="M20 9h2"/>
                    <path d="M9 2v2"/>
                    <path d="M9 20v2"/>
                  </svg>
                </div>
              </foreignObject>
            </g>
            
            {/* Level 1 - 3 branches */}
            <line x1="300" y1="120" x2="180" y2="200" stroke="white" strokeWidth="2" opacity="0.4" className="path-line-1"/>
            <line x1="300" y1="120" x2="300" y2="200" stroke="white" strokeWidth="2" opacity="0.4" className="path-line-2"/>
            <line x1="300" y1="120" x2="420" y2="200" stroke="white" strokeWidth="2" opacity="0.4" className="path-line-3"/>
            
            <rect x="155" y="200" width="50" height="40" rx="8" fill="white" opacity="0.7" className="path-node-1"/>
            <rect x="275" y="200" width="50" height="40" rx="8" fill="white" opacity="0.7" className="path-node-2"/>
            <rect x="395" y="200" width="50" height="40" rx="8" fill="white" opacity="0.7" className="path-node-3"/>
            
            {/* Level 2 - Leaf nodes with variety (2, 1, 3 children) */}
            {/* Left branch - 2 children */}
            <line x1="180" y1="240" x2="130" y2="300" stroke="white" strokeWidth="2" opacity="0.4" className="path-line-1"/>
            <line x1="180" y1="240" x2="210" y2="300" stroke="white" strokeWidth="2" opacity="0.25"/>
            
            <rect x="105" y="300" width="50" height="35" rx="8" fill="white" opacity="0.6" className="path-node-1" filter="url(#glow)"/>
            <rect x="185" y="300" width="50" height="35" rx="8" fill="white" opacity="0.35"/>
            
            {/* Middle branch - 1 child (single) */}
            <line x1="300" y1="240" x2="300" y2="300" stroke="white" strokeWidth="2" opacity="0.4" className="path-line-2"/>
            
            <rect x="275" y="300" width="50" height="35" rx="8" fill="white" opacity="0.6" className="path-node-2" filter="url(#glow)"/>
            
            {/* Right branch - 3 children */}
            <line x1="420" y1="240" x2="360" y2="300" stroke="white" strokeWidth="2" opacity="0.25"/>
            <line x1="420" y1="240" x2="420" y2="300" stroke="white" strokeWidth="2" opacity="0.25"/>
            <line x1="420" y1="240" x2="480" y2="300" stroke="white" strokeWidth="2" opacity="0.4" className="path-line-3"/>
            
            <rect x="335" y="300" width="50" height="35" rx="8" fill="white" opacity="0.35"/>
            <rect x="395" y="300" width="50" height="35" rx="8" fill="white" opacity="0.35"/>
            <rect x="455" y="300" width="50" height="35" rx="8" fill="white" opacity="0.6" className="path-node-3" filter="url(#glow)"/>
          </svg>
        </div>

        {/* Text overlay */}
        <div className="relative z-10 text-white text-center">
          <h1 className="text-4xl font-bold mb-4">AI assisted classification.</h1>
          <p className="text-xl opacity-90">Improve your surveys.</p>
        </div>
      </div>

      {/* Right Panel - Login Form (narrower) */}
      <div className="w-full lg:w-[40%] flex items-center justify-center p-8 bg-white relative">
        <div className="w-full max-w-md">
          {/* Logo and Title */}
          <div className="flex items-center gap-3 mb-8">
            <Image
              src="/logo.svg"
              alt="Logo"
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <h1 className="text-xl font-semibold text-gray-900">classiflow</h1>
          </div>

          {/* Sign in heading - left aligned */}
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Sign in</h2>

          {/* Error message */}
          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Login form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Username or Email
              </label>
              <input
                id="email"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900"
                placeholder=""
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900"
                placeholder=""
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:bg-indigo-300 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

        </div>

        {/* R2 Footer Logo - Bottom Right */}
        <div className="absolute bottom-8 inset-x-0 px-8 flex justify-center">
          <div className="w-full max-w-md flex justify-end">
            <a 
              href="https://rowsquared.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="block hover:opacity-100 transition-opacity"
              style={{ 
                width: '160px',
                opacity: 0.6
              }}
            >
              <Image
                src="/r2-footer.svg"
                alt="Made with ❤️ by R2"
                width={160}
                height={27}
                className="w-full h-auto"
              />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

