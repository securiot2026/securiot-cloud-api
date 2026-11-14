import { Injectable, Logger } from '@nestjs/common';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'onboarding@resend.dev';
const SUBJECT_MAX = 200;
const DETAIL_MAX = 200;
// One plain address: no whitespace, comma, semicolon, angle brackets or quotes.
const PLAIN_ADDRESS = /^[^\s,;<>"']+@[^\s,;<>"']+$/;

/**
 * Sends plain-text email through the Resend REST API (global fetch, no SDK).
 *
 * send never throws or rejects: it resolves true when Resend accepted the message and false
 * otherwise, so a mail problem can never fail the request that triggered it. Variables are read
 * from process.env at call time so tests can toggle them.
 *
 * Without RESEND_API_KEY the service runs in dev mode and sends nothing. The message body (which
 * may hold a reset link) is logged at WARN only when MAIL_DEV_LOG is exactly "1"; by default only
 * the subject is logged.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async send(message: MailMessage): Promise<boolean> {
    const apiKey = (process.env.RESEND_API_KEY ?? '').trim();
    try {
      return await this.deliver(message, apiKey);
    } catch (error) {
      // Defensive net: deliver already handles its known failures.
      const name = error instanceof Error ? error.name : 'Error';
      const line = this.redact(`Unexpected mail failure (${name})`, apiKey);
      this.logger.warn(line);
      return false;
    }
  }

  private async deliver(message: MailMessage, apiKey: string): Promise<boolean> {
    const subject = this.sanitizeSubject(message.subject);

    if (apiKey === '') {
      if (process.env.MAIL_DEV_LOG === '1') {
        const recipient = message.to.trim() === '' ? '(no recipient)' : message.to;
        const devLine = `Dev mode, email not sent (RESEND_API_KEY is not set). To: ${recipient}. Subject: ${subject}\n${message.text}`;
        this.logger.warn(devLine);
      } else {
        const quietLine = `Email not sent because RESEND_API_KEY is not set. Subject: ${subject}`;
        this.logger.warn(quietLine);
      }
      return false;
    }

    if (!this.isPlainAddress(message.to)) {
      const badLine = `Email not sent because the recipient is not a single plain address. Subject: ${subject}`;
      this.logger.warn(badLine);
      return false;
    }

    const from = (process.env.RESEND_FROM ?? '').trim() || DEFAULT_FROM;

    try {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [message.to], subject, text: message.text }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const detail = await this.readErrorDetail(response);
        const failLine = this.redact(`Resend rejected the email with HTTP ${response.status}${detail}`, apiKey);
        this.logger.warn(failLine);
        return false;
      }

      const okLine = `Email sent. Subject: ${subject}`;
      this.logger.log(okLine);
      return true;
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      const text = error instanceof Error ? error.message : 'unknown error';
      const errLine = this.redact(`Resend request failed: ${name}: ${text}`, apiKey);
      this.logger.warn(errLine);
      return false;
    }
  }

  private sanitizeSubject(subject: string): string {
    return subject.replace(/[\r\n]+/g, ' ').trim().slice(0, SUBJECT_MAX);
  }

  private isPlainAddress(to: string): boolean {
    return to.length <= 254 && PLAIN_ADDRESS.test(to);
  }

  private async readErrorDetail(response: Response): Promise<string> {
    try {
      const body = await response.text();
      let parts: string[] = [];
      try {
        const json = JSON.parse(body) as { name?: unknown; message?: unknown };
        parts = [json.name, json.message].filter((v): v is string => typeof v === 'string');
      } catch {
        // Not JSON, ignore the body.
      }
      if (parts.length === 0) return '';
      return `: ${parts.join(': ').slice(0, DETAIL_MAX)}`;
    } catch {
      return '';
    }
  }

  /** Removes every occurrence of the secret and strips CR and LF so a message cannot forge log lines. */
  private redact(message: string, secret: string): string {
    const cleaned = secret === '' ? message : message.split(secret).join('[redacted]');
    return cleaned.replace(/[\r\n]+/g, ' ');
  }
}
