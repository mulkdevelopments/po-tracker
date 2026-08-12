/**
 * Outbound email via the Resend HTTP API.
 *
 * Configured entirely by environment so a deployment without credentials degrades to
 * a no-op instead of failing the request that triggered the mail:
 *   RESEND_API_KEY   — required to actually send
 *   MAIL_FROM        — verified sender, e.g. "Mulk PO Tracker <po@mulkinternational.co>"
 *   MAIL_REPLY_TO    — optional reply-to
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type MailAttachment = { filename: string; content: Buffer };

export type MailMessage = {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: MailAttachment[];
};

export type MailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  if (!isEmailConfigured()) {
    return { sent: false, reason: "Email is not configured (RESEND_API_KEY / MAIL_FROM)" };
  }
  const to = msg.to.filter(Boolean);
  if (!to.length) return { sent: false, reason: "No recipients" };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to,
        cc: msg.cc?.length ? msg.cc : undefined,
        bcc: msg.bcc?.length ? msg.bcc : undefined,
        reply_to: process.env.MAIL_REPLY_TO || undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content.toString("base64"),
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: `Mail provider returned ${res.status} ${body}`.trim() };
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, id: json?.id ?? null };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "Mail send failed" };
  }
}

export function escapeHtml(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
