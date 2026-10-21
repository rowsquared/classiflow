'use client'

import { useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import PageHeader from '@/components/PageHeader'
import Modal from '@/components/Modal'

export type User = {
  id: string
  username: string
  email: string
  name: string | null
  role: 'admin' | 'supervisor' | 'labeller'
  supervisorId: string | null
  supervisor: { id: string; name: string | null; email: string } | null
  labellers: { id: string; name: string | null; email: string }[]
  mustResetPassword: boolean
  lastLogin: Date | null
  createdAt: Date
  updatedAt: Date
  _count: {
    assignedSentences: number
  }
}

type Props = {
  initialUsers: User[]
}

export default function TeamPageClient({ initialUsers }: Props) {
  const { data: session } = useSession()
  const formatLastLoginDate = (date: Date | string | null) => {
    if (!date) return 'Never'
    try {
      const parsed = typeof date === 'string' ? new Date(date) : date
      if (Number.isNaN(parsed.getTime())) return 'Never'
      return new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'UTC',
      }).format(parsed)
    } catch {
      return 'Never'
    }
  }
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [loading, setLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    name: '',
    role: 'labeller' as 'admin' | 'supervisor' | 'labeller',
    supervisorId: '' as string,
    tempPassword: '',
    newPassword: ''
  })
  const [error, setError] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users)
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.username,
          email: formData.email,
          name: formData.name,
          role: formData.role,
          supervisorId: formData.supervisorId || null,
          tempPassword: formData.tempPassword
        })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create user')
        return
      }

      // Reset form and close modal
      setFormData({ username: '', email: '', name: '', role: 'labeller', supervisorId: '', tempPassword: '', newPassword: '' })
      setShowCreateModal(false)
      fetchUsers()
    } catch (error) {
      console.error('Create user error:', error)
      setError('An error occurred')
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return
    setError('')

    try {
      const updatePayload: { name: string; role: User['role']; supervisorId: string | null; newPassword?: string } = {
        name: formData.name,
        role: formData.role,
        supervisorId: formData.supervisorId || null
      }

      if (formData.newPassword) {
        updatePayload.newPassword = formData.newPassword
      }

      const res = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload)
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to update user')
        return
      }

      // Reset form and close modal
      setFormData({ username: '', email: '', name: '', role: 'labeller', supervisorId: '', tempPassword: '', newPassword: '' })
      setSelectedUser(null)
      setShowEditModal(false)
      fetchUsers()
    } catch (error) {
      console.error('Update user error:', error)
      setError('An error occurred')
    }
  }

  const handleDelete = async (userId: string, userName: string | null) => {
    if (!confirm(`Are you sure you want to delete ${userName || 'this user'}? This action cannot be undone.`)) {
      return
    }

    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'Failed to delete user')
        return
      }

      fetchUsers()
    } catch (error) {
      console.error('Delete user error:', error)
      alert('An error occurred')
    }
  }

  const openEditModal = (user: User) => {
    setSelectedUser(user)
    setFormData({
      username: user.username,
      email: user.email,
      name: user.name || '',
      role: user.role,
      supervisorId: user.supervisorId || '',
      tempPassword: '',
      newPassword: ''
    })
    setError('')
    setShowEditModal(true)
  }

  const openCreateModal = () => {
    setFormData({ username: '', email: '', name: '', role: 'labeller', supervisorId: '', tempPassword: '', newPassword: '' })
    setError('')
    setShowCreateModal(true)
  }

  // Get list of potential supervisors (admin and supervisor roles)
  const potentialSupervisors = users.filter(u => u.role === 'admin' || u.role === 'supervisor')

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-indigo-100 text-indigo-700'
      case 'supervisor': return 'bg-indigo-100 text-indigo-700'
      case 'labeller': return 'bg-green-100 text-green-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        <PageHeader title="Team Management" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader title="Team Management" />
      
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Header with Add User button */}
        <div className="flex justify-between items-center mb-6">
          <p className="text-gray-600">
            Manage users, assign roles, and configure supervision relationships
          </p>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add User
          </button>
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Username</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supervisor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supervises</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assignments</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Login</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {user.username}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{user.name || 'N/A'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${getRoleBadgeColor(user.role)}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {user.supervisor ? user.supervisor.name || user.supervisor.email : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {user.labellers.length > 0 ? user.labellers.length : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {user._count.assignedSentences}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatLastLoginDate(user.lastLogin)}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <button
                      onClick={() => openEditModal(user)}
                      className="text-indigo-600 hover:text-indigo-700"
                      title="Edit user"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <Modal label="Create new user" onClose={() => setShowCreateModal(false)} className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Create New User</h2>
            
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as User['role'] })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                >
                  <option value="labeller">Labeller</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supervisor (Optional)</label>
                <select
                  value={formData.supervisorId}
                  onChange={(e) => setFormData({ ...formData, supervisorId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                >
                  <option value="">None</option>
                  {potentialSupervisors.map(supervisor => (
                    <option key={supervisor.id} value={supervisor.id}>
                      {supervisor.name || supervisor.email}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Temporary Password *</label>
                <input
                  type="password"
                  value={formData.tempPassword}
                  onChange={(e) => setFormData({ ...formData, tempPassword: e.target.value })}
                  required
                  minLength={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                />
                <p className="mt-1 text-xs text-gray-500">User will be required to change this on first login</p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <Modal label="Edit user" onClose={() => { setShowEditModal(false); setSelectedUser(null) }} className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Edit User</h2>
            
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as User['role'] })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                >
                  <option value="labeller">Labeller</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supervisor (Optional)</label>
                <select
                  value={formData.supervisorId}
                  onChange={(e) => setFormData({ ...formData, supervisorId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                >
                  <option value="">None</option>
                  {potentialSupervisors.filter(s => s.id !== selectedUser.id).map(supervisor => (
                    <option key={supervisor.id} value={supervisor.id}>
                      {supervisor.name || supervisor.email}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password (Optional)</label>
                <input
                  type="password"
                  value={formData.newPassword}
                  onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                  minLength={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                />
                <p className="mt-1 text-xs text-gray-500">Leave blank to keep current password. User will be required to change it on next login.</p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false)
                    setSelectedUser(null)
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
                >
                  Update User
                </button>
              </div>
            </form>

            {/* Delete User Section */}
            {selectedUser.id !== session?.user?.id && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-sm text-gray-600 mb-3">
                  Delete this user account? This action cannot be undone.
                </p>
                <button
                  onClick={() => {
                    setShowEditModal(false)
                    setSelectedUser(null)
                    handleDelete(selectedUser.id, selectedUser.name)
                  }}
                  className="w-full px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors font-medium"
                >
                  Delete User
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

