import fs from "fs/promises";
import path from "path";
import nodemailer from "nodemailer";
import axios from "axios";
import FormData from "form-data";

export type DeliveryAttachment = {
  path: string;
  name: string;
  mime: string;
  size: number;
};

function getSmtpConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const from = String(process.env.SMTP_FROM || "").trim();
  const secure = ["1", "true", "yes", "on"].includes(
    String(process.env.SMTP_SECURE || "").trim().toLowerCase()
  )
    ? true
    : port === 465;
  const tlsRejectUnauthorized = !["0", "false", "no", "off"].includes(
    String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
  );
  const connectionTimeoutMs = process.env.SMTP_CONNECTION_TIMEOUT_MS
    ? Number(process.env.SMTP_CONNECTION_TIMEOUT_MS)
    : 15000;
  const greetingTimeoutMs = process.env.SMTP_GREETING_TIMEOUT_MS
    ? Number(process.env.SMTP_GREETING_TIMEOUT_MS)
    : 15000;
  const socketTimeoutMs = process.env.SMTP_SOCKET_TIMEOUT_MS
    ? Number(process.env.SMTP_SOCKET_TIMEOUT_MS)
    : 20000;

  return {
    host,
    port,
    user,
    pass,
    from,
    secure,
    tlsRejectUnauthorized,
    connectionTimeoutMs,
    greetingTimeoutMs,
    socketTimeoutMs,
  };
}

function getResendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM || process.env.SMTP_FROM || "").trim();
  const baseUrl = String(process.env.RESEND_BASE_URL || "https://api.resend.com")
    .trim()
    .replace(/\/$/, "");
  return { apiKey, from, baseUrl };
}

function getTelegramToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

function getTeamsWebhook() {
  return String(process.env.TEAMS_WEBHOOK_URL || "").trim();
}

function isRenderRuntime() {
  return String(process.env.RENDER || "").trim().toLowerCase() === "true";
}

export function isEmailReady() {
  const resend = getResendConfig();
  const smtp = getSmtpConfig();
  return Boolean((resend.apiKey && resend.from) || (smtp.host && smtp.port && smtp.from));
}

export function isTelegramReady() {
  return Boolean(getTelegramToken());
}

export function isTeamsReady() {
  return Boolean(getTeamsWebhook());
}

export function isRealDeliveryEnabled() {
  return isEmailReady() || isTelegramReady() || isTeamsReady();
}

export type DeliveryResult = {
  ok: boolean;
  reason?: string;
  delivered?: number;
  failed?: number;
};

async function buildResendAttachments(attachment?: DeliveryAttachment) {
  if (!attachment) return undefined;
  const fileBuffer = await fs.readFile(attachment.path);
  return [
    {
      content: fileBuffer.toString("base64"),
      filename: attachment.name,
      content_type: attachment.mime,
    },
  ];
}

async function sendEmailViaResend(
  to: string[],
  subject: string,
  text: string,
  attachment?: DeliveryAttachment,
  html?: string
): Promise<DeliveryResult> {
  const resend = getResendConfig();
  if (!resend.apiKey || !resend.from) {
    return { ok: false, reason: "Resend is not configured" };
  }

  try {
    const attachments = await buildResendAttachments(attachment);
    await axios.post(
      `${resend.baseUrl}/emails`,
      {
        from: resend.from,
        to,
        subject,
        text,
        html,
        attachments,
      },
      {
        headers: {
          Authorization: `Bearer ${resend.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );
    return { ok: true, delivered: to.length, failed: 0 };
  } catch (err: any) {
    const message =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Resend delivery failed";
    return {
      ok: false,
      reason: `Resend API delivery failed: ${message}`,
      delivered: 0,
      failed: to.length,
    };
  }
}

export async function sendEmail(
  to: string[],
  subject: string,
  text: string,
  attachment?: DeliveryAttachment,
  html?: string
): Promise<DeliveryResult> {
  const resend = getResendConfig();
  const smtp = getSmtpConfig();

  if (resend.apiKey && resend.from) {
    return sendEmailViaResend(to, subject, text, attachment, html);
  }

  if (isRenderRuntime() && [25, 465, 587].includes(Number(smtp.port))) {
    return {
      ok: false,
      reason:
        "Render web services usually block outbound SMTP on ports 25, 465, and 587. Configure RESEND_API_KEY and RESEND_FROM, or use a Render instance/network path that allows SMTP.",
      delivered: 0,
      failed: Array.isArray(to) ? to.length : 0,
    };
  }

  if (!smtp.host || !smtp.port || !smtp.from) {
    return {
      ok: false,
      reason:
        "Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM, or SMTP_HOST and SMTP_FROM.",
    };
  }
  if (!Array.isArray(to) || to.length === 0) {
    return { ok: false, reason: "No email recipients provided" };
  }
  if ((smtp.user && !smtp.pass) || (!smtp.user && smtp.pass)) {
    return {
      ok: false,
      reason: "SMTP auth is incomplete. Set both SMTP_USER and SMTP_PASS, or neither.",
    };
  }

  const transportConfig: any = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    tls: { rejectUnauthorized: smtp.tlsRejectUnauthorized },
    connectionTimeout: smtp.connectionTimeoutMs,
    greetingTimeout: smtp.greetingTimeoutMs,
    socketTimeout: smtp.socketTimeoutMs,
  };
  if (smtp.user && smtp.pass) {
    transportConfig.auth = {
      user: smtp.user,
      pass: smtp.pass,
    };
  }

  const attachments = attachment
    ? [
        {
          filename: attachment.name,
          path: attachment.path,
          contentType: attachment.mime,
        },
      ]
    : [];

  try {
    const transporter = nodemailer.createTransport(transportConfig);
    await transporter.sendMail({
      from: smtp.from,
      to: to.join(", "),
      subject,
      text,
      html,
      attachments,
    });
    return { ok: true, delivered: to.length, failed: 0 };
  } catch (err: any) {
    const code = String(err?.code || "").toUpperCase();
    const responseCode = Number(err?.responseCode || 0);

    let reason = err?.message || "SMTP delivery failed";
    if (code === "ETIMEDOUT" || /timed out/i.test(reason)) {
      reason = `SMTP connection timed out while connecting to ${smtp.host}:${smtp.port}. Check SMTP host/port, provider firewall rules, and whether your hosting platform allows outbound SMTP.`;
    } else if (code === "ECONNREFUSED") {
      reason = `SMTP connection was refused by ${smtp.host}:${smtp.port}. Check SMTP host, port, and whether STARTTLS/SSL settings match your provider.`;
    } else if (responseCode === 535 || /auth/i.test(reason)) {
      reason = "SMTP authentication failed. Check SMTP_USER, SMTP_PASS, and whether SMTP AUTH or an app password is required for this mailbox.";
    }
    if (
      isRenderRuntime() &&
      [25, 465, 587].includes(Number(smtp.port)) &&
      (code === "ETIMEDOUT" || code === "ECONNREFUSED" || /timed out|refused/i.test(reason))
    ) {
      reason = `${reason} Render free web services block outbound SMTP on ports 25, 465, and 587. Use a paid Render instance or configure an HTTPS email API such as Resend via RESEND_API_KEY and RESEND_FROM.`;
    }

    return { ok: false, reason, delivered: 0, failed: to.length };
  }
}

export async function sendTelegram(
  chatIds: string[],
  text: string,
  attachment?: DeliveryAttachment
): Promise<DeliveryResult> {
  const telegramToken = getTelegramToken();
  if (!telegramToken) {
    return { ok: false, reason: "Telegram not configured" };
  }
  if (!Array.isArray(chatIds) || chatIds.length === 0) {
    return { ok: false, reason: "No Telegram recipients provided" };
  }

  const api = `https://api.telegram.org/bot${telegramToken}`;
  const recipients = chatIds
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    return { ok: false, reason: "No valid Telegram recipients provided" };
  }

  let delivered = 0;
  let failed = 0;
  const reasons: string[] = [];

  for (const chatId of recipients) {
    try {
      if (attachment) {
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("caption", text);
        form.append("document", await fs.readFile(attachment.path), {
          filename: attachment.name,
          contentType: attachment.mime,
        });
        await axios.post(`${api}/sendDocument`, form, {
          headers: form.getHeaders(),
          timeout: 15000,
        });
      } else {
        await axios.post(
          `${api}/sendMessage`,
          {
            chat_id: chatId,
            text,
          },
          { timeout: 15000 }
        );
      }
      delivered += 1;
    } catch (err: any) {
      failed += 1;
      const msg =
        err?.response?.data?.description ||
        err?.message ||
        `Telegram delivery failed for ${chatId}`;
      reasons.push(`${chatId}: ${msg}`);
    }
  }

  if (failed > 0) {
    return {
      ok: false,
      reason: reasons.join(" | "),
      delivered,
      failed,
    };
  }

  return { ok: true, delivered, failed: 0 };
}

export async function sendTeams(text: string, attachment?: DeliveryAttachment): Promise<DeliveryResult> {
  const teamsWebhook = getTeamsWebhook();
  if (!teamsWebhook) {
    return { ok: false, reason: "Teams not configured" };
  }

  const message = attachment
    ? `${text}\n\nAttachment: ${attachment.name} (${Math.round(attachment.size / 1024)} KB)`
    : text;

  try {
    await axios.post(
      teamsWebhook,
      {
        text: message,
      },
      { timeout: 15000 }
    );
    return { ok: true, delivered: 1, failed: 0 };
  } catch (err: any) {
    return {
      ok: false,
      reason: err?.response?.data?.message || err?.message || "Teams delivery failed",
      delivered: 0,
      failed: 1,
    };
  }
}

export async function loadAttachmentFromSchedule(schedule: {
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  attachment_size?: number | null;
}) {
  if (!schedule.attachment_path || !schedule.attachment_name) return null;
  const absolutePath = path.isAbsolute(schedule.attachment_path)
    ? schedule.attachment_path
    : path.join(process.cwd(), schedule.attachment_path);
  try {
    await fs.access(absolutePath);
  } catch {
    return null;
  }
  return {
    path: absolutePath,
    name: schedule.attachment_name,
    mime: schedule.attachment_mime || "application/octet-stream",
    size: schedule.attachment_size || 0,
  } as DeliveryAttachment;
}
