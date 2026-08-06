import type { Meeting } from '@campusmeet/shared';
import { createHash } from 'node:crypto';
import { CreateScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type {
  EmailGateway,
  GoogleCalendarGateway,
  ReminderSchedulerGateway,
} from '../domain/ports';
import { NotImplementedError, ServiceConfigurationError } from '../utils/errors';

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new ServiceConfigurationError(`Thiếu cấu hình ${name}.`);
  return value;
};

export class GoogleCalendarAdapter implements GoogleCalendarGateway {
  createEvent(_meeting: Meeting): Promise<{ eventId: string; meetUrl?: string }> {
    // TODO(M4): use a server-side token and Calendar conferenceDataVersion=1; map pending/failure states.
    throw new NotImplementedError('Google Calendar adapter is not implemented');
  }
}

export class EventBridgeSchedulerAdapter implements ReminderSchedulerGateway {
  constructor(private readonly client = new SchedulerClient({})) {}

  async schedule(meeting: Meeting): Promise<{ scheduleId: string }> {
    const scheduleId = `campusmeet-${createHash('sha256').update(meeting.id).digest('hex').slice(0, 24)}`;
    const reminderAt = new Date(new Date(meeting.startsAt).getTime() - 15 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '');
    await this.client.send(
      new CreateScheduleCommand({
        Name: scheduleId,
        ScheduleExpression: `at(${reminderAt})`,
        FlexibleTimeWindow: { Mode: 'OFF' },
        ActionAfterCompletion: 'DELETE',
        Target: {
          Arn: required('REMINDER_FUNCTION_ARN'),
          RoleArn: required('SCHEDULER_EXECUTION_ROLE_ARN'),
          Input: JSON.stringify({ reminderId: scheduleId, meetingId: meeting.id }),
        },
        ClientToken: `meeting-${meeting.id}-v${meeting.version}`,
      }),
    );
    return { scheduleId };
  }
}

export class SesEmailAdapter implements EmailGateway {
  constructor(private readonly client = new SESv2Client({})) {}

  async send(to: string, subject: string, body: string): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: required('SES_FROM_EMAIL'),
        ConfigurationSetName: process.env.SES_CONFIGURATION_SET,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Text: { Data: body, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  }
}
