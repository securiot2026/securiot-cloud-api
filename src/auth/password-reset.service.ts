import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { resolveWebAppBaseUrl } from '../mail/web-app-url';
import { UsersService } from '../users/users.service';
import { PasswordResetToken } from './password-reset-token.entity';

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const FORGOT_PASSWORD_MESSAGE =
  'Si la cuenta existe, se envió una solicitud de restablecimiento al administrador.';
export const RESET_PASSWORD_MESSAGE = 'Tu contraseña se actualizó. Ya puedes iniciar sesión.';

const BCRYPT_COST = 10;
const RESET_SUBJECT = 'Restablecimiento de contraseña de SecurIoT';

function invalidResetTokenError(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Invalid or expired token',
    code: 'invalid_reset_token',
  });
}

function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly tokens: Repository<PasswordResetToken>,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Creates a reset token for the account and mails the link to ADMIN_EMAIL. Never rejects and
   * says nothing about whether the account exists: the controller does not await it.
   */
  async requestReset(email: string): Promise<void> {
    try {
      const user = await this.usersService.findByEmail(email);
      if (!user) {
        return;
      }

      const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim();
      const mailConfigured = (process.env.RESEND_API_KEY ?? '').trim() !== '';
      if (mailConfigured && adminEmail === '') {
        this.logger.warn('Password reset requested but ADMIN_EMAIL is not configured, no token was created');
        return;
      }

      const rawToken = crypto.randomBytes(32).toString('base64url');
      const now = new Date();

      await this.tokens.update({ userId: user.id, usedAt: IsNull() }, { usedAt: now });
      await this.tokens.save(
        this.tokens.create({
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
          usedAt: null,
        }),
      );

      const link = `${resolveWebAppBaseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
      const accountEmail = user.email.replace(/[\r\n]+/g, ' ');
      const text = [
        'Hola,',
        '',
        `Alguien pidió restablecer la contraseña de la cuenta ${accountEmail}. La solicitud te llega a ti, como administrador, porque esa cuenta no tiene un buzón propio.`,
        '',
        'Para elegir una contraseña nueva, abre este enlace:',
        '',
        link,
        '',
        'El enlace vale 30 minutos y solo funciona una vez. Compártelo únicamente con la persona dueña de la cuenta.',
        '',
        'Si no esperabas esta solicitud, ignora este mensaje: la contraseña actual sigue funcionando.',
        '',
        'SecurIoT',
      ].join('\n');

      await this.mailService.send({ to: adminEmail, subject: RESET_SUBJECT, text });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.warn(`Password reset request failed (${name})`);
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const row = await this.tokens.findOne({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt !== null || new Date(row.expiresAt).getTime() <= Date.now()) {
      throw invalidResetTokenError();
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    // Conditional update makes a concurrent double use impossible: only one caller flips usedAt.
    const consumed = await this.tokens.update({ id: row.id, usedAt: IsNull() }, { usedAt: new Date() });
    if (!consumed.affected) {
      throw invalidResetTokenError();
    }

    await this.usersService.updatePasswordHash(row.userId, passwordHash);
    await this.tokens.update({ userId: row.userId, usedAt: IsNull() }, { usedAt: new Date() });

    this.logger.log(`Password reset completed for user ${row.userId}`);
  }
}
