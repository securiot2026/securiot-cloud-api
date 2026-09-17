import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeviceOfflineCheckService, DEVICE_OFFLINE_RULE_TYPE } from './device-offline-check.service';
import { Alert } from './alert.entity';
import { Device } from '../devices/device.entity';
import { Reading } from '../telemetry/entities/reading.entity';

describe('DeviceOfflineCheckService', () => {
  let service: DeviceOfflineCheckService;
  let devicesRepo: { find: jest.Mock };
  let readingsRepo: { findOne: jest.Mock };
  let alertsRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };

  const device = { id: 'device-1', name: 'Front Door', zoneId: 'zone-1' } as Device;

  beforeEach(async () => {
    devicesRepo = { find: jest.fn().mockResolvedValue([device]) };
    readingsRepo = { findOne: jest.fn() };
    alertsRepo = {
      findOne: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
      create: jest.fn((x) => x),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceOfflineCheckService,
        { provide: getRepositoryToken(Device), useValue: devicesRepo },
        { provide: getRepositoryToken(Reading), useValue: readingsRepo },
        { provide: getRepositoryToken(Alert), useValue: alertsRepo },
      ],
    }).compile();

    service = module.get(DeviceOfflineCheckService);
  });

  afterEach(() => {
    delete process.env.DEVICE_ONLINE_WINDOW_SECONDS;
  });

  it('creates a device_offline alert when the device has never reported', async () => {
    readingsRepo.findOne.mockResolvedValue(null);
    alertsRepo.findOne.mockResolvedValue(null);

    await service.checkOfflineDevices();

    expect(alertsRepo.save).toHaveBeenCalledTimes(1);
    const created = alertsRepo.create.mock.calls[0][0];
    expect(created.ruleType).toBe(DEVICE_OFFLINE_RULE_TYPE);
    expect(created.severity).toBe('high');
    expect(created.deviceId).toBe('device-1');
  });

  it('creates a device_offline alert when the last reading is outside the online window', async () => {
    process.env.DEVICE_ONLINE_WINDOW_SECONDS = '60';
    readingsRepo.findOne.mockResolvedValue({
      recordedAt: new Date(Date.now() - 120_000),
    });
    alertsRepo.findOne.mockResolvedValue(null);

    await service.checkOfflineDevices();

    expect(alertsRepo.save).toHaveBeenCalledTimes(1);
  });

  it('does not create a duplicate alert while one is already active', async () => {
    readingsRepo.findOne.mockResolvedValue(null);
    alertsRepo.findOne.mockResolvedValue({ id: 'existing-alert', status: 'active' });

    await service.checkOfflineDevices();

    expect(alertsRepo.save).not.toHaveBeenCalled();
  });

  it('resolves the active alert once the device reports again within the window', async () => {
    process.env.DEVICE_ONLINE_WINDOW_SECONDS = '300';
    readingsRepo.findOne.mockResolvedValue({ recordedAt: new Date() });
    const existing = { id: 'existing-alert', status: 'active' };
    alertsRepo.findOne.mockResolvedValue(existing);

    await service.checkOfflineDevices();

    expect(alertsRepo.save).toHaveBeenCalledWith({ ...existing, status: 'resolved' });
  });

  it('does nothing for a device that is online with no prior offline alert', async () => {
    readingsRepo.findOne.mockResolvedValue({ recordedAt: new Date() });
    alertsRepo.findOne.mockResolvedValue(null);

    await service.checkOfflineDevices();

    expect(alertsRepo.save).not.toHaveBeenCalled();
  });
});
