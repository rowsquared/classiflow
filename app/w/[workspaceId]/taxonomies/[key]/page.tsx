"use client"
import { workspaceApi } from '@/lib/workspace/urls'
import { useEffect, useMemo, useState } from 'react'

type Node = { code: string; label: string; level: number; parentCode: string | null; isLeaf: boolean }

export default function TaxonomyBrowser({ params }: { params: Promise<{ key: string }> }) {
  const [key, setKey] = useState<string>('')
  
  useEffect(() => {
    params.then(({ key }) => setKey(key))
  }, [params])
  const [trail, setTrail] = useState<Node[]>([])
  const [items, setItems] = useState<Node[]>([])
  const [q, setQ] = useState('')
  const level = trail.length === 0 ? 1 : (trail[trail.length - 1].level + 1)
  const parentCode = trail.length === 0 ? '' : String(trail[trail.length - 1].code)

  useEffect(() => {
    if (!key) return
    const url = new URL(workspaceApi(`/taxonomies/${key}/nodes`), window.location.origin)
    if (q) url.searchParams.set('q', q)
    else {
      url.searchParams.set('level', String(level))
      url.searchParams.set('parentCode', parentCode)
    }
    fetch(url.toString())
      .then(r => r.json())
      .then(d => setItems(d.items))
  }, [key, level, parentCode, q])

  const crumb = useMemo(() => trail.map(n => `${n.code} · ${n.label}`).join(' / '), [trail])

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">{key} taxonomy</h1>
      <div className="text-muted-foreground">Level {level}{crumb ? ` — ${crumb}` : ''}</div>
      <div className="flex gap-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search code or text..."
          className="w-full px-3 py-2 rounded border bg-transparent"
        />
        {trail.length > 0 && (
          <button className="px-3 py-2 rounded border" onClick={() => setTrail(trail.slice(0, -1))}>Up</button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 max-h-[70vh] overflow-y-auto border rounded p-2">
        {items.map(n => (
          <button key={n.code} className="text-left flex items-center justify-between px-3 py-2 rounded hover:bg-white/5 border"
            onClick={() => {
              setQ('')
              setTrail(prev => [...prev, n])
            }}
          >
            <span className="truncate">{n.code} · {n.label}</span>
            <span className="opacity-70">{n.isLeaf ? '⟂' : '→'}</span>
          </button>
        ))}
      </div>
    </main>
  )
}


