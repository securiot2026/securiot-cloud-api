import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';

const FAKE_KEY = 're_fake_key_0123456789abcdef';

describe('MailService', () => {
  const saved = {
    key: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM,
    devLog: process.env.MAIL_DEV_LOG,
  };
  let service: MailService;
  let fetchSpy: jest.SpyInstance;
  let spies: Record<'log' | 'warn' | 'error' | 'debug' | 'verbose', jest.SpyInstance>;

  const allLoggedText = (): string =>
    Object.values(spies)
      .flatMap((s) => s.mock.calls.map((c) => c.map((a) => String(a)).join(' ')))
      .join('\n');

  beforeEach(() => {
    process.env.RESEND_API_KEY = FAKE_KEY;
    delete process.env.RESEND_FROM;
    delete process.env.MAIL_DEV_LOG;
    service = new MailService();
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ id: 'abc' }), { status: 200 }),
    );
    spies = {
      log: jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      error: jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
      debug: jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined),
      verbose: jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined),
    };
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    Object.values(spies).forEach((s) => s.mockRestore());
    for (const [name, value] of [
      ['RESEND_API_KEY', saved.key],
      ['RESEND_FROM', saved.from],
      ['MAIL_DEV_LOG', saved.devLog],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('posts the expected request to Resend and resolves true on 200', async () => {
    const ok = await service.send({ to: 'admin@example.test', subject: 'Hola', text: 'cuerpo' });

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      from: 'onboarding@resend.dev',
      to: ['admin@example.test'],
      subject: 'Hola',
      text: 'cuerpo',
    });
  });

  it('uses RESEND_FROM when set', async () => {
    process.env.RESEND_FROM = 'alertas@example.test';
    await service.send({ to: 'admin@example.test', subject: 's', text: 't' });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).from).toBe('alertas@example.test');
  });

  describe('dev mode (RESEND_API_KEY blank)', () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = '   ';
    });

    it('with MAIL_DEV_LOG=1 logs subject and body (the link) once at WARN, no network', async () => {
      process.env.MAIL_DEV_LOG = '1';
      const ok = await service.send({
        to: 'admin@example.test',
        subject: 'Asunto dev',
        text: 'enlace http://web.test/reset-password?token=abc',
      });

      expect(ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(spies.warn).toHaveBeenCalledTimes(1);
      const line = String(spies.warn.mock.calls[0][0]);
      expect(line).toContain('Asunto dev');
      expect(line).toContain('http://web.test/reset-password?token=abc');
    });

    it('without MAIL_DEV_LOG does NOT log the body or link, only the subject', async () => {
      const ok = await service.send({
        to: 'admin@example.test',
        subject: 'Asunto sin link',
        text: 'enlace http://web.test/reset-password?token=secretvalue',
      });

      expect(ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(spies.warn).toHaveBeenCalledTimes(1);
      const line = String(spies.warn.mock.calls[0][0]);
      expect(line).toContain('Asunto sin link');
      expect(allLoggedText()).not.toContain('secretvalue');
      expect(allLoggedText()).not.toContain('reset-password');
    });

    it('MAIL_DEV_LOG values other than exactly 1 do not enable body logging', async () => {
      process.env.MAIL_DEV_LOG = 'true';
      await service.send({ to: 'a@b.test', subject: 's', text: 'linkbody' });
      expect(allLoggedText()).not.toContain('linkbody');
    });
  });

  describe('failure safety', () => {
    it('resolves false on HTTP 422 and never logs the key', async () => {
      fetchSpy.mockImplementation(
        async () =>
          new Response(JSON.stringify({ name: 'validation_error', message: `bad request for ${FAKE_KEY}` }), {
            status: 422,
          }),
      );
      const ok = await service.send({ to: 'admin@example.test', subject: 's', text: 't' });
      expect(ok).toBe(false);
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(String(spies.warn.mock.calls[0][0])).toContain('422');
      expect(allLoggedText()).not.toContain(FAKE_KEY);
    });

    it('resolves false when fetch rejects with an error mentioning the key, and never logs it', async () => {
      fetchSpy.mockImplementation(async () => {
        throw new Error(`connect failed using ${FAKE_KEY}\r\nInjected: line`);
      });
      const ok = await service.send({ to: 'admin@example.test', subject: 's', text: 't' });
      expect(ok).toBe(false);
      expect(allLoggedText()).not.toContain(FAKE_KEY);
      expect(allLoggedText()).not.toMatch(/[\r\n]Injected/);
    });

    it('replaces CR and LF in the subject before sending', async () => {
      await service.send({ to: 'admin@example.test', subject: 'uno\r\ndos\ntres', text: 't' });
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body).subject).toBe('uno dos tres');
    });

    it.each(['a b@example.test', 'a@b.test,c@d.test', 'a@b.test;c@d.test', 'Name <a@b.test>', ''])(
      'rejects invalid recipient %p without calling fetch',
      async (to) => {
        const ok = await service.send({ to, subject: 's', text: 't' });
        expect(ok).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );
  });
});
