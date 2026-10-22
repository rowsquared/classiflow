# Double annotation mockup

Interactive sample of the proposed workflow in the
[implementation plan](../../plans/double-annotation.md). This is a design
preview, not an implemented application feature.

Open [index.html](index.html) directly in a browser. No Next.js server,
database or credentials are needed. It uses illustrative records and keeps
changes local to the preview.

The five screens cover the work queue, assigning independent labellers,
the blind labeller view, reviewing disagreements, and exporting provisional
or confirmed labels. Try selecting a different answer in the labeller view,
then return to the queue to review the resulting disagreement.

## Editing

[source.html](source.html) is the editable fragment.
[index.html](index.html) is its generated standalone preview, including the
sandbox wrapper and fallback interaction-state storage. Keep both in sync.
Optional Codex design controls are inactive outside Codex; the ordinary
preview controls work in a browser. Icons may load from the approved CDN.

To regenerate with the Codex visualization skill installed, run its
`scripts/render.py` with the absolute path to `source.html`, the absolute
path to `index.html`, and `--force`. Do not hand-edit the generated wrapper.
Format the source before regenerating, then run the repository's Prettier
on the generated preview as well.

The mockup was checked with Playwright for filtering, assignment validation,
separate submissions, original and new disagreements, review decisions,
confirmed-only exports, and layouts at 1024, 736, 390 and 320 pixels.
These checks validate the concept's interactions, not application behaviour.
