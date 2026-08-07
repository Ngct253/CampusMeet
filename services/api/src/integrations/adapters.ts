import type { Meeting } from '@campusmeet/shared';
import { createHash } from 'node:crypto';
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type {
  EmailGateway,
  GoogleCalendarGateway,
  ReminderSchedulerGateway,
} from '../domain/ports';
import {
  SecretsManagerGoogleCredentialsProvider,
  type GoogleCredentialsProvider,
} from './google-oauth';
import { GoogleIntegrationRepository } from '../repositories/google-integration';
import { ServiceConfigurationError, UnauthorizedError } from '../utils/errors';

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new ServiceConfigurationError(`Thiếu cấu hình ${name}.`);
  return value;
};

export class GoogleCalendarAdapter implements GoogleCalendarGateway {
  constructor(
    private readonly integrations = new GoogleIntegrationRepository(),
    private readonly credentials: GoogleCredentialsProvider = new SecretsManagerGoogleCredentialsProvider(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async accessToken(userId: string) {
    const stored = await this.integrations.getTokens(userId);
    if (!stored?.refreshToken) throw new UnauthorizedError('Hãy kết nối lại Google Calendar.');
    if (Date.parse(stored.expiresAt) > this.now().getTime() + 60_000) return stored.accessToken;
    const client = await this.credentials.get();
    const response = await this.fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: stored.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (
      !response.ok ||
      typeof body.access_token !== 'string' ||
      typeof body.expires_in !== 'number'
    ) {
      throw new UnauthorizedError('Phiên Google đã hết hạn. Hãy kết nối lại.');
    }
    await this.integrations.saveTokens(userId, {
      accessToken: body.access_token,
      refreshToken: stored.refreshToken,
      expiresAt: new Date(this.now().getTime() + body.expires_in * 1000).toISOString(),
      scope: typeof body.scope === 'string' ? body.scope : stored.scope,
    });
    return body.access_token;
  }

  async createEvent(meeting: Meeting) {
    const token = await this.accessToken(meeting.organizerId);
    const response = await this.fetcher(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          summary: meeting.title,
          description: meeting.description,
          start: { dateTime: meeting.startsAt },
          end: { dateTime: meeting.endsAt },
          conferenceData: {
            createRequest: {
              requestId: `campusmeet-${meeting.id}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        }),
      },
    );
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || typeof body.id !== 'string') {
      throw new Error(`GOOGLE_CALENDAR_CREATE_FAILED:${response.status}`);
    }
    const conference = body.conferenceData as Record<string, unknown> | undefined;
    return {
      eventId: body.id,
      ...(typeof body.hangoutLink === 'string' ? { meetUrl: body.hangoutLink } : {}),
      ...(typeof conference?.conferenceId === 'string'
        ? { googleMeetingId: conference.conferenceId }
        : {}),
    };
  }
}

export class EventBridgeSchedulerAdapter implements ReminderSchedulerGateway {
  constructor(private readonly client = new SchedulerClient({})) {}

  private scheduleId(meetingId: string) {
    return `campusmeet-${createHash('sha256').update(meetingId).digest('hex').slice(0, 24)}`;
  }

  private scheduleInput(meeting: Meeting) {
    const scheduleId = this.scheduleId(meeting.id);
    const reminderAt = new Date(new Date(meeting.startsAt).getTime() - 15 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '');
    return {
      Name: scheduleId,
      ScheduleExpression: `at(${reminderAt})`,
      FlexibleTimeWindow: { Mode: 'OFF' as const },
      ActionAfterCompletion: 'DELETE' as const,
      Target: {
        Arn: required('REMINDER_FUNCTION_ARN'),
        RoleArn: required('SCHEDULER_EXECUTION_ROLE_ARN'),
        Input: JSON.stringify({ reminderId: scheduleId, meetingId: meeting.id }),
      },
    };
  }

  async schedule(meeting: Meeting): Promise<{ scheduleId: string }> {
    const input = this.scheduleInput(meeting);
    try {
      await this.client.send(
        new CreateScheduleCommand({
          ...input,
          ClientToken: `meeting-${meeting.id}-v${meeting.version}`,
        }),
      );
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ConflictException') throw error;
      await this.client.send(new UpdateScheduleCommand(input));
    }
    const scheduleId = this.scheduleId(meeting.id);
    return { scheduleId };
  }

  async cancel(meetingId: string): Promise<void> {
    try {
      await this.client.send(new DeleteScheduleCommand({ Name: this.scheduleId(meetingId) }));
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ResourceNotFoundException') throw error;
    }
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
