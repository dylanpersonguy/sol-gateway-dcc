// ═══════════════════════════════════════════════════════════════
// ALERT DISPATCHER — Multi-channel alerting
// ═══════════════════════════════════════════════════════════════

import { AnomalyAlert } from '../detectors/anomaly-detector';
import axios from 'axios';
import { Logger } from 'winston';

export interface AlertConfig {
  // Webhook URLs for different severity levels
  webhookUrl?: string;
  slackWebhookUrl?: string;
  pagerDutyServiceKey?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  emailSmtpHost?: string;
  emailRecipients?: string[];
}

export class AlertDispatcher {
  private config: AlertConfig;
  private logger: Logger;

  constructor(config: AlertConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async dispatch(alert: AnomalyAlert): Promise<void> {
    this.logger.info(`Dispatching alert: ${alert.severity} — ${alert.message}`);

    const dispatchers: Promise<void>[] = [];

    // Always log
    this.logAlert(alert);

    // Slack for warning+
    if (this.config.slackWebhookUrl && alert.severity !== 'info') {
      dispatchers.push(this.sendSlack(alert));
    }

    // Telegram for critical+
    if (
      this.config.telegramBotToken &&
      (alert.severity === 'critical' || alert.severity === 'emergency')
    ) {
      dispatchers.push(this.sendTelegram(alert));
    }

    // PagerDuty for emergency only
    if (this.config.pagerDutyServiceKey && alert.severity === 'emergency') {
      dispatchers.push(this.sendPagerDuty(alert));
    }

    // Generic webhook for all
    if (this.config.webhookUrl) {
      dispatchers.push(this.sendWebhook(alert));
    }

    await Promise.allSettled(dispatchers);
  }

  private logAlert(alert: AnomalyAlert): void {
    const icon =
      alert.severity === 'emergency'
        ? '🚨'
        : alert.severity === 'critical'
        ? '⚠️'
        : alert.severity === 'warning'
        ? '⚡'
        : 'ℹ️';

    this.logger.log(
      alert.severity === 'emergency' || alert.severity === 'critical'
        ? 'error'
        : 'warn',
      `${icon} ALERT [${alert.severity}] ${alert.category}: ${alert.message}`,
      { data: alert.data }
    );
  }

  private async sendSlack(alert: AnomalyAlert): Promise<void> {
    try {
      const emoji =
        alert.severity === 'emergency'
          ? ':rotating_light:'
          : alert.severity === 'critical'
          ? ':warning:'
          : ':zap:';

      await axios.post(this.config.slackWebhookUrl!, {
        text: `${emoji} *Bridge Alert — ${alert.severity.toUpperCase()}*\n` +
              `*Category:* ${alert.category}\n` +
              `*Message:* ${alert.message}\n` +
              `*Auto-Pause:* ${alert.autoPause ? 'YES' : 'No'}\n` +
              `*Data:* \`\`\`${JSON.stringify(alert.data, null, 2)}\`\`\``,
      });
    } catch (err) {
      this.logger.error('Failed to send Slack alert', { error: err });
    }
  }

  private async sendTelegram(alert: AnomalyAlert): Promise<void> {
    try {
      const text =
        `🚨 BRIDGE ALERT — ${alert.severity.toUpperCase()}\n\n` +
        `Category: ${alert.category}\n` +
        `Message: ${alert.message}\n` +
        `Auto-Pause: ${alert.autoPause ? 'YES' : 'No'}\n` +
        `Time: ${new Date(alert.timestamp).toISOString()}`;

      await axios.post(
        `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`,
        {
          chat_id: this.config.telegramChatId,
          text,
          parse_mode: 'HTML',
        }
      );
    } catch (err) {
      this.logger.error('Failed to send Telegram alert', { error: err });
    }
  }

  private async sendPagerDuty(alert: AnomalyAlert): Promise<void> {
    try {
      await axios.post('https://events.pagerduty.com/v2/enqueue', {
        routing_key: this.config.pagerDutyServiceKey,
        event_action: 'trigger',
        payload: {
          summary: `Bridge Emergency: ${alert.message}`,
          severity: 'critical',
          source: 'sol-gateway-dcc-monitor',
          component: alert.category,
          custom_details: alert.data,
        },
      });
    } catch (err) {
      this.logger.error('Failed to send PagerDuty alert', { error: err });
    }
  }

  private async sendWebhook(alert: AnomalyAlert): Promise<void> {
    try {
      await axios.post(this.config.webhookUrl!, alert, {
        timeout: 5000,
      });
    } catch (err) {
      this.logger.error('Failed to send webhook alert', { error: err });
    }
  }
}
