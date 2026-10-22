'use client'
import { useCallback, useState, useLayoutEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useQueryClient } from '@tanstack/react-query'
import { useSession, signOut, revokeOtherSessions } from '@/lib/auth-client'
import { useWorkspaceInfo } from '@/components/WorkspaceProvider'
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher'
import { ToastContainer, type Toast } from '@/components/Toast'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import Image from 'next/image'
import { Tags } from 'lucide-react'

// Dynamic sizing based on logo width (w)
// Logo width/height: w (20px)
// Collapsed sidebar: 3w (60px)
// Icon size: 1w (20px)
// Spacing from edges: 1w (20px)
// Page header height: 3w (60px)

const LOGO_SIZE = 22 // w in pixels
const SIDEBAR_COLLAPSED_WIDTH = LOGO_SIZE * 3 // 3w = 60px
const ICON_SIZE = LOGO_SIZE * 1 // 1w = 20px
const SPACING = LOGO_SIZE * 1 // 1w = 20px
const HEADER_HEIGHT = LOGO_SIZE * 3 // 3w = 60px
const FOOTER_LOGO_HEIGHT = 48 // Fixed height for R2 footer logo

export default function Sidebar() {
  // Always start with false on both server and client to prevent hydration mismatch
  // We'll update to the correct state in useLayoutEffect before paint
  const [collapsed, setCollapsed] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [logoHovered, setLogoHovered] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const initializedRef = useRef(false)
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])
  const { data: session } = useSession()
  const workspace = useWorkspaceInfo()
  const { href: workspaceHref } = useWorkspacePaths()

  // Read from data attribute and sync state, then remove CSS override
  useLayoutEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    // Read from data attribute set by blocking script
    const dataAttr = document.documentElement.getAttribute('data-sidebar-collapsed')
    let shouldBeCollapsed = false
    if (dataAttr !== null) {
      shouldBeCollapsed = dataAttr === 'true'
    } else {
      // Fallback to localStorage
      const saved = localStorage.getItem('sidebar-collapsed')
      if (saved !== null) {
        shouldBeCollapsed = JSON.parse(saved)
      }
    }

    // Update state to match CSS (which was set by blocking script)
    setCollapsed(shouldBeCollapsed)

    // Remove CSS !important override by adding hydration class
    // This allows React's inline styles to take over
    document.documentElement.classList.add('sidebar-hydrated')

    // Enable transitions after CSS override is removed
    requestAnimationFrame(() => {
      setIsHydrated(true)
    })
  }, [])

  // Hide sidebar on login and reset-password pages (after all hooks)
  if (pathname === '/login' || pathname === '/reset-password') {
    return null
  }

  const toggleCollapse = () => {
    const newState = !collapsed
    setCollapsed(newState)
    localStorage.setItem('sidebar-collapsed', JSON.stringify(newState))
  }

  // Ends this person's sessions in every other browser; this one stays.
  const handleSignOutElsewhere = async () => {
    const { error } = await revokeOtherSessions()
    setToasts([
      error
        ? { id: 'sessions', type: 'error', message: 'Could not sign out the other sessions.' }
        : { id: 'sessions', type: 'success', message: 'Signed out on all other devices.' }
    ])
  }

  const handleLogout = async () => {
    await signOut()
    // Nothing fetched for this user may outlive the session.
    queryClient.clear()
    router.push('/login')
    router.refresh()
  }

  const navItems = [
    {
      icon: (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="5" cy="6" r="1.5" fill="currentColor" />
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="5" cy="18" r="1.5" fill="currentColor" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 6h11M9 12h11M9 18h11" />
        </svg>
      ),
      label: 'Queue',
      href: '/queue',
      roles: ['admin', 'supervisor', 'labeller']
    },
    {
      icon: (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      ),
      label: 'Progress',
      href: '/progress',
      roles: ['admin', 'supervisor', 'labeller']
    },
    {
      icon: <Tags className="w-full h-full" strokeWidth={1.5} />,
      label: 'Taxonomy',
      href: '/admin/taxonomy',
      roles: ['admin']
    },
    {
      icon: (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
          />
        </svg>
      ),
      label: 'Sentences',
      href: '/admin/sentences',
      roles: ['admin']
    },
    {
      icon: (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
      label: 'Export',
      href: '/admin/export',
      roles: ['admin']
    },
    {
      icon: (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ),
      label: 'Team',
      href: '/admin/team',
      roles: ['admin']
    },
    {
      icon: (
        <svg className="w-full h-full" viewBox="0 -0.5 12 13" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M11.787 6.654l-2.895-1.03-1.081-3.403A.324.324 0 007.5 2c-.143 0-.27.09-.311.221l-1.08 3.404-2.897 1.03A.313.313 0 003 6.946c0 .13.085.248.212.293l2.894 1.03 1.082 3.507A.324.324 0 007.5 12c.144 0 .271-.09.312-.224L8.893 8.27l2.895-1.029A.313.313 0 0012 6.947a.314.314 0 00-.213-.293zM4.448 1.77l-1.05-.39-.39-1.05a.444.444 0 00-.833 0l-.39 1.05-1.05.39a.445.445 0 000 .833l1.05.389.39 1.051a.445.445 0 00.833 0l.39-1.051 1.05-.389a.445.445 0 000-.834z"
            stroke="currentColor"
            strokeWidth="0.75"
            strokeLinejoin="round"
          />
        </svg>
      ),
      label: 'AI Jobs',
      href: '/admin/ai-jobs',
      roles: ['admin']
    },
    {
      icon: (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
      label: 'AI Settings',
      href: '/admin/ai',
      roles: ['admin']
    },
    {
      icon: (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
      ),
      label: 'Audit Log',
      href: '/admin/audit',
      roles: ['admin']
    }
  ]

  // Get user from session
  const user = session?.user
    ? {
        name: session.user.name || 'User',
        email: session.user.email || '',
        // The role in the current workspace decides which pages are offered.
        role: workspace?.role ?? 'labeller',
        initials: (session.user.name || 'U')
          .split(' ')
          .map(n => n[0])
          .join('')
          .substring(0, 2)
          .toUpperCase()
      }
    : null

  // The product name; the exercise's own name (e.g. 'HIES 2015') is the
  // workspace's, shown by the WorkspaceSwitcher below and set by its admins.
  const productName = 'classiflow'

  const visibleNavItems = user ? navItems.filter(item => item.roles.includes(user.role)) : []

  const isActive = (path: string) => {
    const href = workspaceHref(path)
    if (path === '/queue') {
      return pathname === href || pathname.startsWith(`${href}/`)
    }
    // Exact match for admin sub-pages
    if (path.startsWith('/admin/')) {
      return pathname === href
    }
    return pathname.startsWith(href)
  }

  return (
    <aside
      aria-label="Main"
      className="bg-gray-50 border-r border-gray-200 flex flex-col sidebar-container"
      suppressHydrationWarning
      style={{
        width: collapsed ? `${SIDEBAR_COLLAPSED_WIDTH}px` : '256px',
        transition: isHydrated ? 'width 300ms ease-in-out' : 'none'
      }}
    >
      {/* Logo Section - Height: 3w (90px) */}
      <div
        className="flex items-center border-b border-gray-200 relative"
        suppressHydrationWarning
        style={{
          height: `${HEADER_HEIGHT}px`,
          paddingLeft: `${SPACING}px`,
          paddingRight: collapsed ? `${SPACING}px` : '12px'
        }}
      >
        {/* Logo and Title Container */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Logo with hover expand button for collapsed state */}
          <div
            className="relative flex-shrink-0 cursor-pointer"
            style={{ width: `${LOGO_SIZE}px`, height: `${LOGO_SIZE}px` }}
            onMouseEnter={() => collapsed && setLogoHovered(true)}
            onMouseLeave={() => setLogoHovered(false)}
            onClick={() => collapsed && toggleCollapse()}
          >
            {collapsed && logoHovered ? (
              // Show expand button on hover when collapsed
              <div className="w-full h-full flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300 transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </div>
            ) : (
              // Show logo
              <Image src="/logo.svg" alt="Logo" width={LOGO_SIZE} height={LOGO_SIZE} className="w-full h-full" />
            )}
          </div>

          {/* Product name - Fades in/out when expanded/collapsed */}
          <h1
            className="text-sm font-semibold text-gray-900 truncate overflow-hidden"
            suppressHydrationWarning
            style={{
              opacity: collapsed ? 0 : 1,
              width: collapsed ? 0 : 'auto',
              transition: isHydrated ? 'opacity 300ms ease-in-out' : 'none'
            }}
          >
            {productName}
          </h1>
        </div>

        {/* Collapse Button - Only visible when expanded */}
        {!collapsed && (
          <button
            onClick={toggleCollapse}
            className="p-1.5 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
            title="Collapse sidebar"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Current workspace and switcher */}
      {workspace && (
        <div className="border-b border-gray-200" style={{ padding: collapsed ? '8px 10px' : '8px 12px' }}>
          <WorkspaceSwitcher workspace={workspace} collapsed={collapsed} />
        </div>
      )}

      {/* Navigation Items */}
      <nav className="flex-1 py-4" aria-label="Workspace pages">
        {visibleNavItems.map(item => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={workspaceHref(item.href)}
              className={`
                flex items-center gap-4 py-3 transition-colors relative
                ${active ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-100'}
              `}
              style={{
                paddingLeft: `${SPACING}px`,
                paddingRight: `${SPACING}px`
              }}
              title={collapsed ? item.label : undefined}
            >
              <div className="flex-shrink-0" style={{ width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px` }}>
                {item.icon}
              </div>
              <span
                className="text-sm font-medium whitespace-nowrap overflow-hidden"
                suppressHydrationWarning
                style={{
                  opacity: collapsed ? 0 : 1,
                  width: collapsed ? 0 : 'auto',
                  transition: isHydrated ? 'opacity 300ms ease-in-out' : 'none'
                }}
              >
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Bottom Section - User, Footer Logo */}
      <div>
        {/* User menu */}
        {user && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="flex items-center gap-3 w-full hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                style={{
                  paddingTop: '12px',
                  paddingBottom: '12px',
                  paddingLeft: `${SPACING}px`,
                  paddingRight: `${SPACING}px`
                }}
              >
                <div
                  className="bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                  style={{ width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px` }}
                  aria-hidden="true"
                >
                  {user.initials}
                </div>
                <div
                  className="flex-1 min-w-0 overflow-hidden text-left"
                  suppressHydrationWarning
                  style={{
                    opacity: collapsed ? 0 : 1,
                    width: collapsed ? 0 : 'auto',
                    transition: isHydrated ? 'opacity 300ms ease-in-out' : 'none'
                  }}
                >
                  <div className="text-sm font-medium text-gray-900 truncate">{user.name}</div>
                </div>
                <span className="sr-only">{collapsed ? `${user.name}, account menu` : 'Account menu'}</span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="top"
                align="start"
                sideOffset={4}
                className="z-50 min-w-[12rem] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden py-1"
              >
                <DropdownMenu.Item
                  onSelect={handleSignOutElsewhere}
                  className="px-4 py-2 text-sm text-gray-700 cursor-pointer outline-none data-[highlighted]:bg-gray-100"
                >
                  Sign out other devices
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild>
                  <Link
                    href="/workspaces"
                    className="block px-4 py-2 text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100"
                  >
                    All workspaces
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />
                <DropdownMenu.Item
                  onSelect={handleLogout}
                  className="px-4 py-2 text-sm text-gray-700 cursor-pointer outline-none data-[highlighted]:bg-gray-100 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                  Logout
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}

        {/* R2 Footer Logo - Always takes same space to prevent jump */}
        <div
          className="flex items-center justify-center"
          style={{
            height: `${FOOTER_LOGO_HEIGHT}px`
          }}
        >
          <a
            href="https://rowsquared.com"
            target="_blank"
            rel="noopener noreferrer"
            className="block hover:opacity-100"
            style={{
              width: '66%',
              opacity: collapsed ? 0 : 0.6,
              pointerEvents: collapsed ? 'none' : 'auto',
              transition: isHydrated ? 'opacity 300ms ease-in-out' : 'none'
            }}
          >
            <Image src="/r2-footer.svg" alt="Made with ❤️ by R2" width={120} height={20} className="w-full h-auto" />
          </a>
        </div>
      </div>
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </aside>
  )
}

// Export constants for use in other components
export { HEADER_HEIGHT, LOGO_SIZE, SIDEBAR_COLLAPSED_WIDTH }
