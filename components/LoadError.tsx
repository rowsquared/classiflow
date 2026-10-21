import PageHeader from './PageHeader'

/**
 * Shown by a server page when loading its data failed, so a broken load is not
 * mistaken for an empty list. Reloading the page tries again.
 */
export default function LoadError({ title, what }: { title: string; what: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="px-8 py-8">
        <div role="alert" className="p-4 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
          Could not load {what}. Reload the page to try again; if it keeps failing, the server log has the details.
        </div>
      </div>
    </>
  )
}
