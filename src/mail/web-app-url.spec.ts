import { Logger } from '@nestjs/common';
import { resolveWebAppBaseUrl } from './web-app-url';

describe('resolveWebAppBaseUrl', () => {
  const original = process.env.WEB_APP_URL;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    if (original === undefined) {
      delete process.env.WEB_APP_URL;
    } else {
      process.env.WEB_APP_URL = original;
    }
  });

  it('defaults to http://localhost:4200 when unset or blank', () => {
    delete process.env.WEB_APP_URL;
    expect(resolveWebAppBaseUrl()).toBe('http://localhost:4200');
    process.env.WEB_APP_URL = '   ';
    expect(resolveWebAppBaseUrl()).toBe('http://localhost:4200');
    expect(warn).not.toHaveBeenCalled();
  });

  it('removes a trailing slash and keeps a path without its trailing slash', () => {
    process.env.WEB_APP_URL = 'https://app.example.test/';
    expect(resolveWebAppBaseUrl()).toBe('https://app.example.test');
    process.env.WEB_APP_URL = 'https://app.example.test/securiot/';
    expect(resolveWebAppBaseUrl()).toBe('https://app.example.test/securiot');
  });

  it('drops query string and fragment', () => {
    process.env.WEB_APP_URL = 'https://app.example.test/x/?a=1#frag';
    expect(resolveWebAppBaseUrl()).toBe('https://app.example.test/x');
  });

  it('falls back to the default for unsafe or unparsable values without printing them', () => {
    for (const bad of ['javascript:alert(1)', 'https://user:pass@evil.test', 'not a url at all']) {
      warn.mockClear();
      process.env.WEB_APP_URL = bad;
      expect(resolveWebAppBaseUrl()).toBe('http://localhost:4200');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toContain('pass');
      expect(String(warn.mock.calls[0][0])).not.toContain('evil.test');
    }
  });
});
