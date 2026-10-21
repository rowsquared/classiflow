import { redirect } from 'next/navigation'

export default async function AdminPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  redirect(`/w/${workspaceId}/admin/taxonomy`)
}
