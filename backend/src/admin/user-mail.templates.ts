import { siteUrl, supportEmail } from '../common/support-contact';

/** Escapes text before it is placed inside an HTML e-mail. */
export function escHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f1f5f9;padding:16px">
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="background:#4f46e5;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:700">SSC Prep Hub</div>
    <div style="padding:24px;color:#334155;font-size:15px;line-height:1.6">
      <h2 style="margin:0 0 12px;color:#0f172a;font-size:20px">${escHtml(heading)}</h2>
      ${bodyHtml}
      <p style="margin:24px 0 0;color:#64748b;font-size:13px">Need help? Write to <a href="mailto:${escHtml(supportEmail())}" style="color:#4f46e5">${escHtml(supportEmail())}</a> from your registered email address.</p>
    </div>
    <div style="padding:12px 24px;background:#f8fafc;color:#94a3b8;font-size:12px">This is an automated message from <a href="${escHtml(siteUrl())}" style="color:#94a3b8">${escHtml(siteUrl().replace(/^https?:\/\//, ''))}</a>.</div>
  </div>
</body></html>`;
}

function reasonBlock(reason?: string | null): string {
  const r = (reason || '').trim();
  if (!r) return '';
  return `<div style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid #4f46e5;border-radius:4px"><div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">Reason</div><div style="margin-top:4px;white-space:pre-wrap">${escHtml(r)}</div></div>`;
}

export function suspendedMail(name: string, email: string, reason?: string | null) {
  return {
    subject: 'Your SSC Prep Hub account has been suspended',
    html: shell(
      'Your account has been suspended',
      `<p>Hi ${escHtml(name || 'there')},</p>
       <p>Your SSC Prep Hub account (<b>${escHtml(email)}</b>) has been suspended by our team. You are signed out on all devices and cannot log in until the suspension is lifted.</p>
       ${reasonBlock(reason)}
       <p>Your progress, test history and purchases are safe and will be available again if your account is restored.</p>
       <p>If you think this is a mistake, reply to us at the address below and we will review it.</p>`,
    ),
  };
}

export function restoredMail(name: string, email: string) {
  return {
    subject: 'Your SSC Prep Hub account is active again',
    html: shell(
      'Your account is active again',
      `<p>Hi ${escHtml(name || 'there')},</p>
       <p>The suspension on your SSC Prep Hub account (<b>${escHtml(email)}</b>) has been lifted. You can log in again and continue your preparation.</p>
       <p style="margin:20px 0"><a href="${escHtml(siteUrl())}/login" style="background:#4f46e5;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Log in</a></p>`,
    ),
  };
}

export function deletedMail(name: string, email: string, reason?: string | null) {
  return {
    subject: 'Your SSC Prep Hub account has been deleted',
    html: shell(
      'Your account has been permanently deleted',
      `<p>Hi ${escHtml(name || 'there')},</p>
       <p>Your SSC Prep Hub account (<b>${escHtml(email)}</b>) has been permanently deleted by our team.</p>
       ${reasonBlock(reason)}
       <p>Your profile, test attempts, bookmarks, notes, progress and subscriptions have been removed and cannot be recovered. Payment records are kept only as required for accounting, and are no longer linked to a profile.</p>
       <p>If you did not expect this, please contact us at the address below.</p>`,
    ),
  };
}
