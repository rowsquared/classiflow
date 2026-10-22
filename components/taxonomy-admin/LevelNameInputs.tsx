'use client'

/** One name input per level, 1 to `depth`; names are keyed by the level as a string. */
export default function LevelNameInputs({
  depth,
  levelNames,
  onChange
}: {
  depth: number
  levelNames: Record<string, string>
  onChange: (levelNames: Record<string, string>) => void
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: depth }, (_, i) => i + 1).map(level => (
        <div key={level} className="flex items-center gap-2">
          <label htmlFor={`level-name-${level}`} className="text-sm text-gray-600 w-16">
            Level {level}:
          </label>
          <input
            id={`level-name-${level}`}
            type="text"
            value={levelNames[level.toString()] || ''}
            onChange={e => onChange({ ...levelNames, [level.toString()]: e.target.value })}
            placeholder={`Level ${level}`}
            className="flex-1 px-3 py-2 border border-gray-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-gray-900"
          />
        </div>
      ))}
    </div>
  )
}
