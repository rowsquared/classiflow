import { renderMail } from './layout'

/** One mail: subject plus HTML and plain-text bodies. */
export type MailTemplate = { subject: string; html: string; text: string }

const roleName = (role: string) => (role === 'labeller' ? 'labeller' : role)

function hoursText(hours: number) {
  return hours % 24 === 0 ? `${hours / 24} day${hours === 24 ? '' : 's'}` : `${hours} hours`
}

/** A new account: choose a password through the link. */
export function invitationMail(input: {
  name: string
  username: string
  workspaceName: string | null
  role: string | null
  url: string
  hours: number
}): MailTemplate {
  const where =
    input.workspaceName && input.role
      ? `You have been added to the workspace “${input.workspaceName}” as ${roleName(input.role)}.`
      : 'An account has been created for you.'
  return {
    subject: 'Your classiflow account',
    ...renderMail({
      preheader: 'Choose a password to start using classiflow.',
      heading: `Welcome, ${input.name}`,
      blocks: [
        { type: 'text', text: where },
        { type: 'text', text: `Your username is ${input.username}. Choose a password to sign in:` },
        { type: 'button', label: 'Choose a password', url: input.url },
        { type: 'text', text: `The link works for ${hoursText(input.hours)}. If it has expired, ask your admin.` }
      ]
    })
  }
}

/** An invitation to join a workspace with an existing (or future) account. */
export function workspaceInvitationMail(input: {
  workspaceName: string
  role: string
  url: string
  hours: number
}): MailTemplate {
  return {
    subject: `Invitation to “${input.workspaceName}” on classiflow`,
    ...renderMail({
      preheader: `You are invited to a classiflow workspace.`,
      heading: 'You are invited to a workspace',
      blocks: [
        {
          type: 'text',
          text: `You are invited to join “${input.workspaceName}” as ${roleName(input.role)}.`
        },
        {
          type: 'text',
          text: 'Open the link and sign in with the classiflow account that uses this email address to accept.'
        },
        { type: 'button', label: 'Open the invitation', url: input.url },
        {
          type: 'text',
          text: `The invitation is valid for ${hoursText(input.hours)}. If you have no account with this address, ask the person who invited you.`
        }
      ]
    })
  }
}

export function passwordLinkMail(input: { name: string; username: string; url: string; minutes: number }) {
  return {
    subject: 'Set a new classiflow password',
    ...renderMail({
      preheader: 'Someone asked for a new password for your classiflow account.',
      heading: 'Set a new password',
      blocks: [
        {
          type: 'text',
          text: `A new password was requested for the account ${input.username}. Use this link to choose one:`
        },
        { type: 'button', label: 'Choose a new password', url: input.url },
        {
          type: 'text',
          text: `The link works for ${input.minutes} minutes and only once. If you did not ask for it, ignore this message; your password stays the same.`
        }
      ]
    })
  } satisfies MailTemplate
}

export function passwordChangedMail(input: { name: string; username: string; signInUrl: string }): MailTemplate {
  return {
    subject: 'Your classiflow password was changed',
    ...renderMail({
      preheader: 'The password of your classiflow account was changed.',
      heading: 'Your password was changed',
      blocks: [
        {
          type: 'text',
          text: `The password of the account ${input.username} was just changed, and every device was signed out.`
        },
        {
          type: 'text',
          text: 'If this was not you, contact your admin at once.'
        },
        { type: 'button', label: 'Sign in', url: input.signInUrl }
      ]
    })
  }
}

/** Sent to the previous address. */
export function emailChangedMail(input: { username: string }): MailTemplate {
  return {
    subject: 'Your classiflow email address was changed',
    ...renderMail({
      preheader: 'The email address of your classiflow account was changed.',
      heading: 'Your email address was changed',
      blocks: [
        {
          type: 'text',
          text: `An admin changed the email address of the account ${input.username}. Mail for this account no longer goes to this address.`
        },
        { type: 'text', text: 'If you did not expect this, contact your admin.' }
      ]
    })
  }
}

/**
 * A generated temporary password. Never stored, never resent: the body exists
 * only in memory while it is being sent.
 */
export function credentialsMail(input: {
  name: string
  username: string
  password: string
  workspaceName: string | null
  role: string | null
  signInUrl: string
}): MailTemplate {
  const where =
    input.workspaceName && input.role
      ? `You have been added to the workspace “${input.workspaceName}” as ${roleName(input.role)}.`
      : 'An account has been created for you.'
  return {
    subject: 'Your classiflow sign-in details',
    ...renderMail({
      preheader: 'Your classiflow account is ready.',
      heading: `Welcome, ${input.name}`,
      blocks: [
        { type: 'text', text: where },
        { type: 'text', text: 'Sign in with these details. You will be asked to choose your own password first.' },
        { type: 'code', lines: [`Username: ${input.username}`, `Temporary password: ${input.password}`] },
        { type: 'button', label: 'Sign in', url: input.signInUrl },
        {
          type: 'text',
          text: 'The temporary password works until you change it. Do not forward this message.'
        }
      ]
    })
  }
}
