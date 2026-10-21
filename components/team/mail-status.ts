const STATUS: Record<string, string> = {
  pending: 'email queued',
  sending: 'email sending',
  sent: 'email sent',
  failed: 'email failed',
  unknown: 'email may not have arrived'
}

const PURPOSE: Record<string, string> = {
  invitation: 'Invitation',
  workspace_invitation: 'Workspace invitation',
  password_link: 'Password link',
  password_changed: 'Password changed notice',
  email_changed: 'Email changed notice',
  credentials: 'Sign-in details'
}

/** How the Team page names an outgoing mail's status (OutgoingMail.status). */
export function mailStatusLabel(status: string): string {
  return STATUS[status] ?? status
}

export function mailPurposeLabel(purpose: string): string {
  return PURPOSE[purpose] ?? purpose
}
