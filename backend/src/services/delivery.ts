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

const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM;

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const teamsWebhook = process.env.TEAMS_WEBHOOK_URL;

export const isEmailReady = !!(smtpHost && smtpPort && smtpUser && smtpPass && smtpFrom);
export const isTelegramReady = !!telegramToken;
export const isTeamsReady = !!teamsWebhook;

export function isRealDeliveryEnabled() {
  return isEmailReady || isTelegramReady || isTeamsReady;
}

export async function sendEmail(
  to: string[],
  subject: string,
  text: string,
  attachment?: DeliveryAttachment
) {
  if (!isEmailReady) {
    return { ok: false, reason: "SMTP not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const attachments = attachment
    ? [
        {
          filename: attachment.name,
          path: attachment.path,
          contentType: attachment.mime,
        },
      ]
    : [];

  await transporter.sendMail({
    from: smtpFrom,
    to: to.join(", "),
    subject,
    text,
    attachments,
  });

  return { ok: true };
}

export async function sendTelegram(
  chatIds: string[],
  text: string,
  attachment?: DeliveryAttachment
) {
  if (!isTelegramReady) {
    return { ok: false, reason: "Telegram not configured" };
  }

  const api = `https://api.telegram.org/bot${telegramToken}`;

  for (const chatId of chatIds) {
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
      });
    } else {
      await axios.post(`${api}/sendMessage`, {
        chat_id: chatId,
        text,
      });
    }
  }

  return { ok: true };
}

export async function sendTeams(text: string, attachment?: DeliveryAttachment) {
  if (!isTeamsReady) {
    return { ok: false, reason: "Teams not configured" };
  }

  const message = attachment
    ? `${text}\n\nAttachment: ${attachment.name} (${Math.round(attachment.size / 1024)} KB)`
    : text;

  await axios.post(teamsWebhook as string, {
    text: message,
  });

  return { ok: true };
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
