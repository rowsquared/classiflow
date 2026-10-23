'use client'
import { useCallback, useState, useLayoutEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { useSession, signOut, revokeOtherSessions } from '@/lib/auth-client'
import { useWorkspaceInfo } from '@/components/WorkspaceProvider'
import { ToastContainer, type Toast } from '@/components/Toast'
import Image from 'next/image'
import {
  ChartColumn,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  FileDown,
  List,
  LogOut,
  MessageSquareText,
  Settings,
  Sparkles,
  Tags,
  Users
} from 'lucide-react'

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
  const directory = useQuery({
    queryKey: queryKeys.workspaces(),
    queryFn: ({ signal }) =>
      fetchJson<{ workspaces: Array<{ id: string; role: string }> }>('/api/workspaces', { signal })
  })
  const workspace = useWorkspaceInfo()
  // Global pages keep the last workspace for navigation; data hooks still use the URL.
  const workspaceHref = (path: string) => `/w/${workspace?.id ?? ''}${path}`

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
      icon: <List className="w-full h-full" strokeWidth={1.5} />,
      label: 'Queue',
      href: '/queue',
      roles: ['admin', 'supervisor', 'labeller']
    },
    {
      icon: <ChartColumn className="w-full h-full" strokeWidth={1.5} />,
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
      icon: <MessageSquareText className="w-full h-full" strokeWidth={1.5} />,
      label: 'Sentences',
      href: '/admin/sentences',
      roles: ['admin']
    },
    {
      icon: <FileDown className="w-full h-full" strokeWidth={1.5} />,
      label: 'Export',
      href: '/admin/export',
      roles: ['admin']
    },
    {
      icon: <Sparkles className="w-full h-full" strokeWidth={1.5} />,
      label: 'AI jobs',
      href: '/admin/ai-jobs',
      roles: ['admin']
    },
    {
      icon: <Settings className="w-full h-full" strokeWidth={1.5} />,
      label: 'AI settings',
      href: '/admin/ai',
      roles: ['admin']
    },
    {
      icon: <ClipboardCheck className="w-full h-full" strokeWidth={1.5} />,
      label: 'Audit log',
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
  // workspace's, shown in the page header and set by its admins.
  const productName = 'classiflow'

  const visibleNavItems = user && workspace ? navItems.filter(item => item.roles.includes(user.role)) : []
  const platform = session?.user.role === 'admin'
  const canManageUsers = platform || directory.data?.workspaces.some(w => w.role === 'admin')
  const globalItems = [
    ...(canManageUsers
      ? [
          {
            href: workspace && workspace.role === 'admin' ? `/users?workspace=${workspace.id}` : '/users',
            label: 'Users',
            icon: Users
          }
        ]
      : []),
    { href: '/workspaces', label: 'Workspaces', icon: List },
    ...(platform ? [{ href: '/ai-services', label: 'AI services', icon: Sparkles }] : [])
  ]

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
                <ChevronsRight className="w-4 h-4" aria-hidden="true" />
              </div>
            ) : (
              // Show logo
              <Image src="/logo.svg" alt="classiflow" width={LOGO_SIZE} height={LOGO_SIZE} className="w-full h-full" />
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
            <ChevronsLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
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
                ${active ? 'bg-indigo-50 text-indigo-800 font-semibold' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}
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
                  className="text-sm whitespace-nowrap overflow-hidden"
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

        <nav aria-label={canManageUsers ? 'Administration' : 'Workspaces'} className="border-t border-gray-200 py-2">
          {canManageUsers && !collapsed && (
            <p className="px-5 py-2 text-xs font-medium text-gray-600">Administration</p>
          )}
          {globalItems.map(item => (
            <Link
              key={item.label}
              href={item.href}
              aria-current={pathname === item.href.split('?')[0] ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-4 px-5 py-3 text-sm ${pathname === item.href.split('?')[0] ? 'bg-indigo-50 text-indigo-800' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              <item.icon size={ICON_SIZE} strokeWidth={1.5} aria-hidden="true" />
              <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>
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
                  className="bg-indigo-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
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
                {session?.user.role === 'admin' && (
                  <DropdownMenu.Item asChild>
                    <Link
                      href="/users"
                      className="block px-4 py-2 text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100"
                    >
                      Users
                    </Link>
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />
                <DropdownMenu.Item
                  onSelect={handleLogout}
                  className="px-4 py-2 text-sm text-gray-700 cursor-pointer outline-none data-[highlighted]:bg-gray-100 flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                  Logout
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}

        {/* made with love by rowsquared - Always takes same space to prevent jump */}
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
            className="block"
            style={{
              width: '66%',
              opacity: collapsed ? 0 : 1,
              pointerEvents: collapsed ? 'none' : 'auto',
              transition: isHydrated ? 'opacity 300ms ease-in-out' : 'none'
            }}
          >
            <Image
              src="/r2-footer.svg"
              alt="made with love by rowsquared"
              width={120}
              height={20}
              className="w-full h-auto"
            />
          </a>
        </div>
      </div>
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </aside>
  )
}

// Export constants for use in other components
export { HEADER_HEIGHT, LOGO_SIZE, SIDEBAR_COLLAPSED_WIDTH }
