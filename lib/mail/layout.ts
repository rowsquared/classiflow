/**
 * Email-safe HTML: a table layout with inline styles on every element, no
 * <style> block, no images, and a hidden preheader (the preview line on lock
 * screens, so it never carries a password or a link). Every interpolated value
 * is escaped. Each mail also has a plain-text version with the same content.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type MailBlock =
  | { type: 'text'; text: string }
  | { type: 'button'; label: string; url: string }
  /** Monospaced lines, e.g. sign-in details. */
  | { type: 'code'; lines: string[] }

export type MailContent = {
  /** Preview text: never a secret or a link. */
  preheader: string
  heading: string
  blocks: MailBlock[]
  footer?: string
}

const FONT = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function blockHtml(block: MailBlock): string {
  switch (block.type) {
    case 'text':
      return `<p style="margin:0 0 16px 0;${FONT};font-size:15px;line-height:22px;color:#1f2937;">${escapeHtml(block.text)}</p>`
    case 'button':
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;"><tr>` +
        `<td style="background-color:#0d9488;border-radius:6px;">` +
        `<a href="${escapeHtml(block.url)}" style="display:inline-block;padding:12px 20px;${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(block.label)}</a>` +
        `</td></tr></table>` +
        `<p style="margin:0 0 16px 0;${FONT};font-size:13px;line-height:18px;color:#6b7280;">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all;color:#374151;">${escapeHtml(block.url)}</span></p>`
      )
    case 'code':
      return `<pre style="margin:0 0 16px 0;padding:12px;background-color:#f3f4f6;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:14px;line-height:20px;color:#111827;white-space:pre-wrap;">${block.lines.map(escapeHtml).join('\n')}</pre>`
  }
}

function blockText(block: MailBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'button':
      return `${block.label}:\n${block.url}`
    case 'code':
      return block.lines.join('\n')
  }
}

export function renderMail(content: MailContent): { html: string; text: string } {
  const footer = content.footer ?? 'This message was sent by classiflow. If you did not expect it, you can ignore it.'
  const html =
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(content.heading)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:#f3f4f6;">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f6;font-size:1px;line-height:1px;">${escapeHtml(content.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;"><tr><td style="padding:28px 28px 12px 28px;">` +
    `<p style="margin:0 0 20px 0;${FONT};font-size:14px;font-weight:600;color:#0f766e;">classiflow</p>` +
    `<h1 style="margin:0 0 16px 0;${FONT};font-size:20px;line-height:28px;color:#111827;">${escapeHtml(content.heading)}</h1>` +
    content.blocks.map(blockHtml).join('') +
    `</td></tr><tr><td style="padding:0 28px 24px 28px;"><p style="margin:0;${FONT};font-size:12px;line-height:18px;color:#9ca3af;">${escapeHtml(footer)}</p></td></tr></table>` +
    `</td></tr></table></body></html>`
  const text = [content.heading, '', ...content.blocks.flatMap(b => [blockText(b), '']), footer].join('\n')
  return { html, text }
}
