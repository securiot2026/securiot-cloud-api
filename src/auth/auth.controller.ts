import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { PasswordResetRateLimiter } from './password-reset-rate-limiter';
import {
  FORGOT_PASSWORD_MESSAGE,
  PasswordResetService,
  RESET_PASSWORD_MESSAGE,
} from './password-reset.service';

function clientAddress(req: Request): string {
  // Never read X-Forwarded-For here: it is client-controlled and would let a caller pick a fresh
  // bucket per request. req.ip only honors it when Express trust proxy is enabled.
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

function tooManyRequests(res: Response, retryAfterSeconds: number): HttpException {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return new HttpException(
    {
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many requests, try again later',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
    private readonly rateLimiter: PasswordResetRateLimiter,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email/password and receive a JWT' })
  @ApiResponse({ status: 200, description: 'Login successful, returns access_token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 400, description: 'Validation failed on request body' })
  login(@Body() dto: LoginDto): Promise<{ access_token: string }> {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always answers 202 with the same body, whether or not the account exists. When it does, the reset link is delivered to the administrator mailbox (ADMIN_EMAIL), not to the account holder, who has no mailbox of their own. The link lasts 30 minutes and works once.',
  })
  @ApiResponse({ status: 202, description: 'Request accepted (same answer for every well-formed email)' })
  @ApiResponse({ status: 400, description: 'Validation failed on request body' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): { message: string } {
    const verdict = this.rateLimiter.checkForgot(clientAddress(req), dto.email);
    if (!verdict.allowed) {
      throw tooManyRequests(res, verdict.retryAfterSeconds);
    }
    // Not awaited on purpose: the response must not depend on lookup or mail latency.
    // requestReset never rejects.
    void this.passwordResetService.requestReset(dto.email);
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password with a reset token' })
  @ApiResponse({ status: 200, description: 'Password updated' })
  @ApiResponse({
    status: 400,
    description:
      'Invalid or expired token (code invalid_reset_token), or the new password violates the policy (10 characters minimum, 72 bytes maximum)',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const verdict = this.rateLimiter.checkReset(clientAddress(req));
    if (!verdict.allowed) {
      throw tooManyRequests(res, verdict.retryAfterSeconds);
    }
    await this.passwordResetService.resetPassword(dto.token, dto.newPassword);
    return { message: RESET_PASSWORD_MESSAGE };
  }
}
