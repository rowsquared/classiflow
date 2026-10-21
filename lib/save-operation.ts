/**
 * The `operationId` of a label save (lib/labeling-activity.ts): one id per
 * save attempt, and the same id again when the same labels are sent once
 * more after a failure. A save whose response was lost may already have
 * committed; sending it again with its id records its activity only once,
 * while a deliberate later save of the same record counts again.
 */
export class SaveOperation {
  private pending: { payload: string; id: string } | null = null

  /** The id for saving `payload` (any stable description of what is saved). */
  idFor(payload: string): string {
    if (this.pending?.payload !== payload) this.pending = { payload, id: crypto.randomUUID() }
    return this.pending.id
  }

  /** The save went through; the next one is a new operation. */
  succeeded(): void {
    this.pending = null
  }
}
