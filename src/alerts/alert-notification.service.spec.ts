import { Test, TestingModule } from '@nestjs/testing';
import { AlertNotificationService, ALERT_EMAIL_THROTTLE_MS } from './alert-notification.service';
import { MailService } from '../mail/mail.service';

describe('AlertNotificationService', () => {
  let service: AlertNotificationService;
  let send: jest.Mock;

  const alert = {
    deviceId: 'device-1',
    zoneId: 'zone-1',
    ruleType: 'door_forced',
    severity: 'high',
    message: 'Puerta forzada en la entrada',
  };

  beforeEach(async () => {
    send = jest.fn().mockResolvedValue(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [AlertNotificationService, { provide: MailService, useValue: { send } }],
    }).compile();
    service = module.get(AlertNotificationService);
    process.env.ADMIN_EMAIL = 'admin@example.test';
    process.env.WEB_APP_URL = 'http://web.example.test:4200';
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.WEB_APP_URL;
    delete process.env.EDGE_DEVICE_SHARED_SECRET;
    delete process.env.EDGE_ADMIN_API_KEY;
    delete process.env.JWT_SECRET;
    jest.restoreAllMocks();
  });

  it('sends nothing and does no work when ADMIN_EMAIL is unset or blank', () => {
    delete process.env.ADMIN_EMAIL;
    service.notifyNewAlert(alert);
    process.env.ADMIN_EMAIL = '   ';
    service.notifyNewAlert(alert);
    expect(send).not.toHaveBeenCalled();

    // The throttle map was not touched: once ADMIN_EMAIL is set the first call sends.
    process.env.ADMIN_EMAIL = 'admin@example.test';
    service.notifyNewAlert(alert);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends one Spanish plain-text email with the five alert fields and the alerts link', () => {
    service.notifyNewAlert(alert);

    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(message.to).toBe('admin@example.test');
    expect(message.subject).toContain('SecurIoT');
    expect(message.subject).toContain('alerta');
    expect(message.subject).toContain('high');
    expect(message.subject).toContain('door_forced');
    expect(message.text).toContain('nueva alerta');
    expect(message.text).toContain('door_forced');
    expect(message.text).toContain('high');
    expect(message.text).toContain('Puerta forzada en la entrada');
    expect(message.text).toContain('device-1');
    expect(message.text).toContain('zone-1');
    expect(message.text).toContain('http://web.example.test:4200/alerts');
    expect(message.text).not.toMatch(/[–—]/);
    expect(message.text).not.toContain('<');
  });

  it('throttles per device and rule type for 10 minutes', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);

    service.notifyNewAlert(alert);
    expect(send).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + 60_000);
    service.notifyNewAlert(alert);
    expect(send).toHaveBeenCalledTimes(1);

    service.notifyNewAlert({ ...alert, deviceId: 'device-2' });
    expect(send).toHaveBeenCalledTimes(2);

    service.notifyNewAlert({ ...alert, ruleType: 'device_offline' });
    expect(send).toHaveBeenCalledTimes(3);

    now.mockReturnValue(1_000_000 + ALERT_EMAIL_THROTTLE_MS - 1);
    service.notifyNewAlert(alert);
    expect(send).toHaveBeenCalledTimes(3);

    now.mockReturnValue(1_000_000 + ALERT_EMAIL_THROTTLE_MS + 1);
    service.notifyNewAlert(alert);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('uses an unambiguous key so different device and rule pairs never collide', () => {
    service.notifyNewAlert({ ...alert, deviceId: 'a', ruleType: 'b:c' });
    service.notifyNewAlert({ ...alert, deviceId: 'a:b', ruleType: 'c' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('never throws or leaks a rejection when send rejects', async () => {
    send.mockRejectedValue(new Error('provider down'));
    let result: unknown = 'unset';
    expect(() => {
      result = service.notifyNewAlert(alert);
    }).not.toThrow();
    expect(result).toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('never throws when send throws synchronously', () => {
    send.mockImplementation(() => {
      throw new Error('sync boom');
    });
    let result: unknown = 'unset';
    expect(() => {
      result = service.notifyNewAlert(alert);
    }).not.toThrow();
    expect(result).toBeUndefined();
  });

  it('returns synchronously when send never settles', () => {
    send.mockReturnValue(new Promise(() => undefined));
    const result = service.notifyNewAlert(alert);
    expect(result).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('strips CR and LF from the subject and caps its length', () => {
    service.notifyNewAlert({
      ...alert,
      ruleType: `evil\r\nBcc: attacker@example.test ${'x'.repeat(300)}`,
      severity: 'hi\r\ngh',
    });
    const message = send.mock.calls[0][0] as { subject: string; text: string };
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.subject.length).toBeLessThanOrEqual(120);
  });

  it('caps the message length, strips control characters and never includes env secrets', () => {
    process.env.EDGE_DEVICE_SHARED_SECRET = 'super-secret-shared-value';
    process.env.EDGE_ADMIN_API_KEY = 'super-secret-admin-value';
    process.env.JWT_SECRET = 'super-secret-jwt-value';

    service.notifyNewAlert({ ...alert, message: `${'m'.repeat(900)}\u0000\u0007end` });
    const message = send.mock.calls[0][0] as { text: string };

    const longRun = /m{501}/;
    expect(message.text).not.toMatch(longRun);
    expect(message.text).toMatch(/m{500}/);
    // eslint-disable-next-line no-control-regex
    expect(message.text).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
    expect(message.text).not.toContain('super-secret-shared-value');
    expect(message.text).not.toContain('super-secret-admin-value');
    expect(message.text).not.toContain('super-secret-jwt-value');
  });

  it('prunes old entries once the throttle map grows past 500 keys', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(5_000_000);
    for (let i = 0; i < 501; i++) {
      service.notifyNewAlert({ ...alert, deviceId: `bulk-${i}` });
    }
    expect(send).toHaveBeenCalledTimes(501);

    now.mockReturnValue(5_000_000 + ALERT_EMAIL_THROTTLE_MS + 1);
    service.notifyNewAlert({ ...alert, deviceId: 'fresh' });
    expect((service as unknown as { lastSent: Map<string, number> }).lastSent.size).toBeLessThanOrEqual(2);
  });
});
