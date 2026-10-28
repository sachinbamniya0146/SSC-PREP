/**
 * Where students are told to write to when something needs a human (suspension, deletion, billing).
 * SUPPORT_EMAIL wins; otherwise the admin mailbox; otherwise the project default.
 */
export function supportEmail(): string {
  return (
    (process.env.SUPPORT_EMAIL || '').trim() ||
    (process.env.ADMIN_DEFAULT_EMAIL || '').trim() ||
    'admin@sscprephub.in'
  );
}

export function siteUrl(): string {
  return (process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://sscprephub.in').replace(/\/+$/, '');
}

export function suspendedMessage(): string {
  return `Your account has been suspended. Please contact ${supportEmail()} if you think this is a mistake.`;
}
