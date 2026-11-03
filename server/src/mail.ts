// Email: through SMTP_URL with nodemailer, or to the log when it is not set.

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { config } from "./config.ts";

let transport: Transporter | null = null;

/** Sends a plain-text email; `replyTo` is where a reply goes instead of MAIL_FROM. */
export async function sendMail(to: string, subject: string, text: string, replyTo?: string): Promise<void> {
  if (!config.smtpUrl) {
    console.log(`[mail] to ${to}: ${subject}\n${text}\n`);
    return;
  }
  transport ??= nodemailer.createTransport(config.smtpUrl);
  await transport.sendMail({ from: config.mailFrom, to, subject, text, ...(replyTo ? { replyTo } : {}) });
}
