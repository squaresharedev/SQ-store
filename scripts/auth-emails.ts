// Squareshare's Supabase Auth emails: on-brand templates plus the custom SMTP
// sender, kept as code so a design change is one edit here and one apply.
//
//   node --env-file-if-exists=.env.local scripts/auth-emails.ts preview [dir]
//       writes every template to HTML files so they can be opened in a browser
//   node --env-file-if-exists=.env.local scripts/auth-emails.ts assets
//       renders the icon PNGs and uploads them to the public email-assets bucket
//   node --env-file-if-exists=.env.local scripts/auth-emails.ts apply
//       pushes subjects + templates (and SMTP, when BREVO_SMTP_* is set) to the
//       Supabase project through the Management API (needs SUPABASE_ACCESS_TOKEN)
//
// The SMTP relay is Brevo. Supabase's built-in mailer cannot send from a custom
// address, so the sender only changes once BREVO_SMTP_USER / BREVO_SMTP_KEY exist.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARROW_ICON, HERO_ICONS, svg } from "./auth-email-icons.ts";

/** Visible sender: the address must be a verified sender/domain in Brevo. */
const SENDER_EMAIL = "info@squareshare.eu";
const SENDER_NAME = "Squareshare";
const BREVO_HOST = "smtp-relay.brevo.com";
const BREVO_PORT = "587";
const SITE_URL = "https://squareshare.eu";
/** The SQ mark (Store/public/img/logo.png), served from the marketing site. */
/** Public Storage bucket holding the PNG icons (`assets` command uploads them). */
const ASSET_URL = "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/email-assets";
const LOGO_URL = `${SITE_URL}/img/logo.png`;

/** Mirrors the globals.css theme tokens; email clients cannot read CSS variables. */
const INK = "#0a0a0c"; // --color-card-base
const PAPER = "#f9f9f9"; // --color-surface-light
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const DARK_PAPER = "#0a0a0c";
const DARK_CARD = "#141416";
const DARK_MUTED = "#a1a1aa";
const DARK_RULE = "#2a2a2e";
const FONT = "'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif";

type Template = {
  subject: string;
  /** Hero tile, a HERO_ICONS key (auth-email-icons.ts). */
  icon: string;
  /** Small caps label above the headline. */
  eyebrow: string;
  title: string;
  /** Body paragraphs (HTML allowed). */
  body: string[];
  /** Call to action button; omit for code / notice emails. */
  cta?: { label: string; href: string };
  /** A one-time code shown large instead of a button. */
  code?: string;
  /** Muted closing line. */
  footnote?: string;
};

const p = (html: string) =>
  `<p class="ink" style="margin:0 0 16px;font:400 15px/1.6 ${FONT};color:${INK};">${html}</p>`;

/**
 * Dark-mode overrides (Apple Mail, iOS, Outlook.com honour them; clients that
 * do not simply keep the light design). Inline styles win unless !important.
 */
const DARK_CSS = `
  @media (prefers-color-scheme: dark) {
    .bg { background:${DARK_PAPER} !important; }
    .card { background:${DARK_CARD} !important; border-color:${DARK_RULE} !important; }
    .ink { color:#ffffff !important; }
    .muted, .muted a { color:${DARK_MUTED} !important; }
    .rule { border-color:${DARK_RULE} !important; }
    .btn { background:#ffffff !important; }
    .btn a { color:${INK} !important; }
    .code { background:${DARK_PAPER} !important; border-color:${DARK_RULE} !important; color:#ffffff !important; }
    .tile { border:1px solid ${DARK_RULE} !important; }
    .arrow-light { display:none !important; }
    .arrow-dark { display:inline-block !important; }
  }`;

/** The ONE layout every auth email shares. Sharp corners, black and white only. */
function layout(t: Template): string {
  const arrow = (name: string, cls: string, hidden: boolean) =>
    `<img class="${cls}" src="${ASSET_URL}/${name}.png" width="18" height="18" alt="" style="${hidden ? "display:none;" : "display:inline-block;"}vertical-align:middle;margin-left:10px;border:0;">`;
  const button = t.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td class="btn" style="background:${INK};"><a href="${t.cta.href}" style="display:inline-block;padding:15px 26px;font:600 15px/18px ${FONT};color:#ffffff;text-decoration:none;">${t.cta.label}${arrow("arrow", "arrow-light", false)}${arrow("arrow-dark", "arrow-dark", true)}</a></td></tr></table>
       <p class="muted" style="margin:0 0 24px;font:400 12px/1.6 ${FONT};color:${MUTED};">Button not working? Paste this link into your browser:<br><a href="${t.cta.href}" style="color:${MUTED};word-break:break-all;">${t.cta.href}</a></p>`
    : "";
  const code = t.code
    ? `<div class="code" style="margin:8px 0 24px;padding:18px 20px;background:${PAPER};border:1px solid ${RULE};text-align:center;font:600 30px/1 'JetBrains Mono',Menlo,Consolas,monospace;letter-spacing:6px;color:${INK};">${t.code}</div>`
    : "";
  const foot = t.footnote
    ? `<div class="muted rule" style="border-top:1px solid ${RULE};padding-top:18px;margin-top:8px;font:400 13px/1.6 ${FONT};color:${MUTED};">${t.footnote}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${t.subject}</title><style>${DARK_CSS}</style></head>
<body class="bg" style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${PAPER};"><tr><td align="center" style="padding:40px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
    <tr><td style="padding:0 0 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td><img class="tile" src="${LOGO_URL}" width="44" height="44" alt="Squareshare" style="display:block;border:1px solid ${RULE};"></td>
        <td class="ink" style="padding-left:12px;font:700 18px/1 ${FONT};color:${INK};letter-spacing:-0.3px;">Squareshare</td>
      </tr></table>
    </td></tr>
    <tr><td class="card" style="background:#ffffff;border:1px solid ${RULE};">
      <div style="padding:36px 32px;">
      <img class="tile" src="${ASSET_URL}/${t.icon}.png" width="56" height="56" alt="" style="display:block;border:0;margin:0 0 24px;">
      <div class="muted" style="font:600 11px/1 ${FONT};letter-spacing:1.5px;text-transform:uppercase;color:${MUTED};margin:0 0 12px;">${t.eyebrow}</div>
      <h1 class="ink" style="margin:0 0 20px;font:700 26px/1.2 ${FONT};color:${INK};letter-spacing:-0.5px;">${t.title}</h1>
      ${t.body.map(p).join("\n      ")}
      ${button}${code}${foot}
      </div>
    </td></tr>
    <tr><td class="muted" style="padding:20px 0 0;font:400 12px/1.6 ${FONT};color:${MUTED};">
      Sent by <a href="${SITE_URL}" style="color:${MUTED};">Squareshare</a> &middot; <a href="mailto:${SENDER_EMAIL}" style="color:${MUTED};">${SENDER_EMAIL}</a><br>You received this because of activity on your Squareshare account.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const IGNORE = "If you didn't request this, you can safely ignore this email.";
const NOT_YOU = `If this wasn't you, <a href="mailto:${SENDER_EMAIL}" style="color:inherit;text-decoration:underline;">contact us</a> right away and reset your password.`;
const LINK = "{{ .ConfirmationURL }}";

/** Keyed by Supabase's mailer config names (mailer_{subjects,templates}_<key>). */
const TEMPLATES: Record<string, Template> = {
  confirmation: {
    icon: "mail",
    subject: "Confirm your Squareshare email",
    eyebrow: "Welcome",
    title: "Confirm your email address",
    body: ["Thanks for signing up. Confirm this email address to finish creating your account and start building your store."],
    cta: { label: "Confirm email address", href: LINK },
    footnote: IGNORE,
  },
  invite: {
    icon: "user-plus",
    subject: "You've been invited to Squareshare",
    eyebrow: "Invitation",
    title: "You've been invited",
    body: ["You've been invited to create a Squareshare account. Accept the invitation to get started."],
    cta: { label: "Accept invitation", href: LINK },
    footnote: IGNORE,
  },
  magic_link: {
    icon: "log-in",
    subject: "Your Squareshare sign-in link",
    eyebrow: "Sign in",
    title: "Your sign-in link",
    body: ["Use the button below to sign in. The link expires shortly and works once."],
    cta: { label: "Sign in to Squareshare", href: LINK },
    footnote: IGNORE,
  },
  recovery: {
    icon: "key",
    subject: "Reset your Squareshare password",
    eyebrow: "Password",
    title: "Reset your password",
    body: ["We received a request to reset your password. Choose a new one with the button below."],
    cta: { label: "Reset password", href: LINK },
    footnote: IGNORE,
  },
  email_change: {
    icon: "mail",
    subject: "Confirm your new Squareshare email",
    eyebrow: "Account",
    title: "Confirm your new email address",
    body: ["Confirm <strong>{{ .NewEmail }}</strong> as the new email address for your account."],
    cta: { label: "Confirm new email", href: LINK },
    footnote: IGNORE,
  },
  reauthentication: {
    icon: "shield",
    subject: "{{ .Token }} is your Squareshare verification code",
    eyebrow: "Security",
    title: "Your verification code",
    body: ["Enter this code to verify it's you. It expires shortly."],
    code: "{{ .Token }}",
    footnote: IGNORE,
  },
  password_changed_notification: {
    icon: "lock",
    subject: "Your Squareshare password was changed",
    eyebrow: "Security",
    title: "Your password was changed",
    body: ["The password for your account was just changed."],
    footnote: NOT_YOU,
  },
  email_changed_notification: {
    icon: "mail",
    subject: "Your Squareshare email address was changed",
    eyebrow: "Security",
    title: "Your email address was changed",
    body: ["The email address for your account was changed from <strong>{{ .OldEmail }}</strong> to <strong>{{ .Email }}</strong>."],
    footnote: NOT_YOU,
  },
  phone_changed_notification: {
    icon: "phone",
    subject: "Your Squareshare phone number was changed",
    eyebrow: "Security",
    title: "Your phone number was changed",
    body: ["The phone number for your account was changed from <strong>{{ .OldPhone }}</strong> to <strong>{{ .Phone }}</strong>."],
    footnote: NOT_YOU,
  },
  mfa_factor_enrolled_notification: {
    icon: "shield-plus",
    subject: "A new verification method was added to your Squareshare account",
    eyebrow: "Security",
    title: "A verification method was added",
    body: ["The sign-in verification method <strong>{{ .FactorType }}</strong> was added to your account."],
    footnote: NOT_YOU,
  },
  mfa_factor_unenrolled_notification: {
    icon: "shield-minus",
    subject: "A verification method was removed from your Squareshare account",
    eyebrow: "Security",
    title: "A verification method was removed",
    body: ["The sign-in verification method <strong>{{ .FactorType }}</strong> was removed from your account."],
    footnote: NOT_YOU,
  },
  identity_linked_notification: {
    icon: "link",
    subject: "A new sign-in method was linked to your Squareshare account",
    eyebrow: "Security",
    title: "A sign-in method was linked",
    body: ["Your <strong>{{ .Provider }}</strong> account was linked as a new sign-in method for {{ .Email }}."],
    footnote: NOT_YOU,
  },
  identity_unlinked_notification: {
    icon: "unlink",
    subject: "A sign-in method was removed from your Squareshare account",
    eyebrow: "Security",
    title: "A sign-in method was removed",
    body: ["Your <strong>{{ .Provider }}</strong> account was removed as a sign-in method for {{ .Email }}."],
    footnote: NOT_YOU,
  },
};

async function apply(): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!token || !url) throw new Error("SUPABASE_ACCESS_TOKEN and NEXT_PUBLIC_SUPABASE_URL are required");
  const ref = new URL(url).hostname.split(".")[0];

  const patch: Record<string, string | number> = {};
  for (const [key, t] of Object.entries(TEMPLATES)) {
    patch[`mailer_subjects_${key}`] = t.subject;
    patch[`mailer_templates_${key}_content`] = layout(t);
  }

  const smtpUser = process.env.BREVO_SMTP_USER;
  const smtpKey = process.env.BREVO_SMTP_KEY;
  if (smtpUser && smtpKey) {
    Object.assign(patch, {
      smtp_admin_email: SENDER_EMAIL,
      smtp_sender_name: SENDER_NAME,
      smtp_host: BREVO_HOST,
      smtp_port: BREVO_PORT,
      smtp_user: smtpUser,
      smtp_pass: smtpKey,
      // Custom SMTP starts at a very low hourly cap; Brevo does its own limiting.
      rate_limit_email_sent: 30,
    });
  } else {
    console.warn("BREVO_SMTP_USER / BREVO_SMTP_KEY not set: templates only, sender unchanged.");
  }

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  console.log(`Applied ${Object.keys(TEMPLATES).length} templates${smtpUser ? " + SMTP" : ""} to ${ref}.`);
}

async function assets(): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const headers = { Authorization: `Bearer ${key}`, apikey: key };
  // Idempotent: a 400/409 just means the bucket exists already.
  await fetch(`${base}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "email-assets", name: "email-assets", public: true }),
  });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const shots: [string, string, number, boolean][] = [
    ...Object.entries(HERO_ICONS).map(([n, inner]): [string, string, number, boolean] => [n, svg(inner, "#ffffff", 56, INK), 56, false]),
    ["arrow", svg(ARROW_ICON, "#ffffff", 18), 18, true],
    ["arrow-dark", svg(ARROW_ICON, INK, 18), 18, true],
  ];
  for (const [name, markup, size, transparent] of shots) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">${markup}</body>`);
    const png = await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
    const res = await fetch(`${base}/storage/v1/object/email-assets/${name}.png`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "image/png", "x-upsert": "true", "cache-control": "max-age=31536000" },
      body: new Uint8Array(png),
    });
    if (!res.ok) throw new Error(`upload ${name}: ${res.status} ${await res.text()}`);
  }
  await browser.close();
  console.log(`Uploaded ${shots.length} icons to email-assets.`);
}

function preview(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const [key, t] of Object.entries(TEMPLATES)) {
    // Fill Supabase's Go placeholders with sample values so the file reads like the real mail.
    const html = layout(t)
      .replaceAll("{{ .ConfirmationURL }}", `${SITE_URL}/auth/confirm?token=sample`)
      .replaceAll("{{ .Token }}", "48213975")
      .replaceAll("{{ .NewEmail }}", "new@example.com")
      .replaceAll("{{ .OldEmail }}", "old@example.com")
      .replaceAll("{{ .Email }}", "you@example.com")
      .replaceAll("{{ .FactorType }}", "totp")
      .replaceAll("{{ .Provider }}", "Google");
    writeFileSync(join(dir, `${key}.html`), html);
  }
  console.log(`Wrote ${Object.keys(TEMPLATES).length} previews to ${dir}`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "apply") await apply();
else if (cmd === "assets") await assets();
else if (cmd === "preview") preview(arg ?? "auth-email-previews");
else console.log("usage: auth-emails.ts preview [dir] | apply | assets");
