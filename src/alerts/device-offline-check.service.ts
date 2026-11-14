import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert } from './alert.entity';
import { AlertNotificationService } from './alert-notification.service';
import { Device } from '../devices/device.entity';
import { Reading } from '../telemetry/entities/reading.entity';
import { isWithinOnlineWindow, resolveLastSeen } from '../devices/device-presence';

const DEFAULT_ONLINE_WINDOW_SECONDS = 300;
export const DEVICE_OFFLINE_RULE_TYPE = 'device_offline';

// EXTR-01: generate an alert when a device transitions online -> offline,
// and resolve it automatically when it reports again. Presence comes from the
// Edge heartbeat (Device.lastSeenAt, driven by /frames requests) as well as from
// Readings, so an empty scene stays online; a device that has never reported
// (no heartbeat, no Reading) is skipped entirely (D-06). Deliberately
// separate from AlertsService.evaluateRule() — that method turns a single
// incoming Reading into an Alert; this is the one place in the system that
// generates an alert from the *absence* of a Reading, which needs a
// periodic sweep, not an event handler.
@Injectable()
export class DeviceOfflineCheckService {
  private readonly logger = new Logger(DeviceOfflineCheckService.name);

  constructor(
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
    @InjectRepository(Reading)
    private readonly readingsRepository: Repository<Reading>,
    @InjectRepository(Alert)
    private readonly alertsRepository: Repository<Alert>,
    private readonly alertNotificationService: AlertNotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkOfflineDevices(): Promise<void> {
    const windowMs =
      Number(process.env.DEVICE_ONLINE_WINDOW_SECONDS || DEFAULT_ONLINE_WINDOW_SECONDS) * 1000;
    const devices = await this.devicesRepository.find();

    for (const device of devices) {
      const lastReading = await this.readingsRepository.findOne({
        where: { deviceId: device.id },
        order: { recordedAt: 'DESC' },
      });

      const lastSeen = resolveLastSeen(device.lastSeenAt, lastReading?.recordedAt);
      if (lastSeen === null) continue;

      const isOnline = isWithinOnlineWindow(lastSeen, windowMs, Date.now());

      const activeOfflineAlert = await this.alertsRepository.findOne({
        where: { deviceId: device.id, ruleType: DEVICE_OFFLINE_RULE_TYPE, status: 'active' },
      });

      if (!isOnline && !activeOfflineAlert) {
        const message = `Device '${device.name}' has not reported within the last ${windowMs / 1000}s`;
        await this.alertsRepository.save(
          this.alertsRepository.create({
            zoneId: device.zoneId,
            deviceId: device.id,
            readingId: null,
            ruleType: DEVICE_OFFLINE_RULE_TYPE,
            severity: 'high',
            status: 'active',
            message,
          }),
        );
        this.logger.warn(`Device ${device.id} (${device.name}) went offline`);
        this.notifyAdmin(device, message);
      } else if (isOnline && activeOfflineAlert) {
        activeOfflineAlert.status = 'resolved';
        await this.alertsRepository.save(activeOfflineAlert);
        this.logger.log(`Device ${device.id} (${device.name}) is back online`);
      }
    }
  }

  // Not awaited and wrapped so the sweep never depends on the notifier behaving.
  private notifyAdmin(device: Device, message: string): void {
    try {
      this.alertNotificationService.notifyNewAlert({
        deviceId: device.id,
        zoneId: device.zoneId,
        ruleType: DEVICE_OFFLINE_RULE_TYPE,
        severity: 'high',
        message,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.warn(`Offline alert email failed (${name})`);
    }
  }
}
