import { Injectable, Logger } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { resolveWebAppBaseUrl } from '../mail/web-app-url';

export const ALERT_EMAIL_THROTTLE_MS = 10 * 60 * 1000;

const SUBJECT_MAX = 120;
const MESSAGE_MAX = 500;
const FIELD_MAX = 120;
const MAP_PRUNE_THRESHOLD = 500;
const KEY_SEPARATOR = '\u0000';

export interface NewAlertInfo {
  deviceId: string;
  zoneId: string;
  ruleType: string;
  severity: string;
  message: string;
}

/**
 * Emails the administrator (ADMIN_EMAIL) when the alerts engine creates a new Alert.
 *
 * notifyNewAlert returns void and never throws: callers do not await it, so a slow, failing or
 * hanging mail provider can never affect telemetry ingest or the offline cron. At most one email
 * is sent per device and alert type every 10 minutes. The throttle map lives in memory, is per
 * process and resets on restart. ADMIN_EMAIL is read at call time; when blank nothing happens.
 */
@Injectable()
export class AlertNotificationService {
  private readonly logger = new Logger(AlertNotificationService.name);
  private readonly lastSent = new Map<string, number>();

  constructor(private readonly mailService: MailService) {}

  notifyNewAlert(alert: NewAlertInfo): void {
    try {
      const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim();
      if (adminEmail === '') {
        return;
      }

      const key = `${alert.deviceId}${KEY_SEPARATOR}${alert.ruleType}`;
      const now = Date.now();
      const previous = this.lastSent.get(key);
      if (previous !== undefined && now - previous < ALERT_EMAIL_THROTTLE_MS) {
        return;
      }

      // Recorded at attempt time so a failing provider is not hammered on every alert.
      this.lastSent.set(key, now);
      if (this.lastSent.size > MAP_PRUNE_THRESHOLD) {
        this.pruneExpired(now);
      }

      const subject = this.buildSubject(alert);
      const text = this.buildBody(alert);
      void this.mailService.send({ to: adminEmail, subject, text }).catch((error: unknown) => {
        this.logger.warn(`Alert email failed (${this.errorName(error)})`);
      });
    } catch (error) {
      this.logger.warn(`Alert email failed (${this.errorName(error)})`);
    }
  }

  private pruneExpired(now: number): void {
    for (const [key, sentAt] of this.lastSent) {
      if (now - sentAt >= ALERT_EMAIL_THROTTLE_MS) {
        this.lastSent.delete(key);
      }
    }
  }

  private buildSubject(alert: NewAlertInfo): string {
    const severity = this.clean(alert.severity, FIELD_MAX);
    const ruleType = this.clean(alert.ruleType, FIELD_MAX);
    return `SecurIoT: nueva alerta ${severity} (${ruleType})`.replace(/[\r\n]+/g, ' ').slice(0, SUBJECT_MAX);
  }

  private buildBody(alert: NewAlertInfo): string {
    const link = `${resolveWebAppBaseUrl()}/alerts`;
    return [
      'Hola, SecurIoT generó una nueva alerta.',
      '',
      `Tipo: ${this.clean(alert.ruleType, FIELD_MAX)}`,
      `Severidad: ${this.clean(alert.severity, FIELD_MAX)}`,
      `Mensaje: ${this.clean(alert.message, MESSAGE_MAX)}`,
      `Dispositivo: ${this.clean(alert.deviceId, FIELD_MAX)}`,
      `Zona: ${this.clean(alert.zoneId, FIELD_MAX)}`,
      '',
      `Revísala aquí: ${link}`,
    ].join('\n');
  }

  /** Replaces control characters (CR and LF included) with a space and caps the length. */
  private clean(value: unknown, max: number): string {
    const text = typeof value === 'string' ? value : String(value ?? '');
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
  }

  private errorName(error: unknown): string {
    return error instanceof Error ? error.name : 'Error';
  }
}
