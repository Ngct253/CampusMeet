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
  GoogleSyncRetryScheduler,
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
    if (response.status === 429 || response.status >= 500) {
      throw new GoogleProviderError(response.status);
    }
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

  private eventId(meetingId: string) {
    return `cm${createHash('sha256').update(meetingId).digest('hex')}`;
  }

  private async calendarRequest(
    token: string,
    url: string,
    init: RequestInit,
    allowed: number[] = [],
  ) {
    const response = await this.fetcher(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok && !allowed.includes(response.status)) {
      let reason: string | undefined;
      try {
        const body = (await response.clone().json()) as {
          error?: { errors?: Array<{ reason?: unknown }>; status?: unknown };
        };
        const candidate = body.error?.errors?.[0]?.reason ?? body.error?.status;
        if (typeof candidate === 'string' && /^[A-Za-z0-9_]+$/.test(candidate)) reason = candidate;
      } catch {
        // Provider bodies are intentionally neither persisted nor logged.
      }
      throw new GoogleProviderError(response.status, reason);
    }
    return response;
  }

  private eventBody(meeting: Meeting, includeConference: boolean) {
    return {
      summary: meeting.title,
      description: meeting.description,
      start: { dateTime: meeting.startsAt },
      end: { dateTime: meeting.endsAt },
      extendedProperties: { private: { campusMeetMeetingId: meeting.id } },
      ...(includeConference
        ? {
            conferenceData: {
              createRequest: {
                requestId: `cm-${createHash('sha256').update(meeting.id).digest('hex').slice(0, 32)}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          }
        : {}),
    };
  }

  private result(body: Record<string, unknown>, eventId: string) {
    return {
      eventId,
      ...(typeof body.hangoutLink === 'string' ? { meetUrl: body.hangoutLink } : {}),
    };
  }

  async ensureScheduledMeeting(
    meeting: Meeting,
    current: { googleEventId?: string; meetUrl?: string },
  ) {
    const token = await this.accessToken(meeting.organizerId);
    const eventId = current.googleEventId ?? this.eventId(meeting.id);
    const eventUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`;
    const existing = await this.calendarRequest(token, eventUrl, { method: 'GET' }, [404]);
    if (existing.ok) {
      const response = await this.calendarRequest(token, eventUrl, {
        method: 'PATCH',
        body: JSON.stringify(this.eventBody(meeting, false)),
      });
      return this.result((await response.json()) as Record<string, unknown>, eventId);
    }
    const response = await this.calendarRequest(
      token,
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
      {
        method: 'POST',
        body: JSON.stringify({ id: eventId, ...this.eventBody(meeting, true) }),
      },
      [409],
    );
    if (response.status === 409) {
      const adopted = await this.calendarRequest(token, eventUrl, {
        method: 'PATCH',
        body: JSON.stringify(this.eventBody(meeting, false)),
      });
      return this.result((await adopted.json()) as Record<string, unknown>, eventId);
    }
    return this.result((await response.json()) as Record<string, unknown>, eventId);
  }

  async ensureCancelledMeeting(meeting: Meeting, googleEventId?: string) {
    const token = await this.accessToken(meeting.organizerId);
    const eventId = googleEventId ?? this.eventId(meeting.id);
    await this.calendarRequest(
      token,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
      [404, 410],
    );
  }
}

export class GoogleProviderError extends Error {
  constructor(
    readonly status: number,
    readonly reason?: string,
  ) {
    super(`GOOGLE_PROVIDER_${status}`);
    this.name = 'GoogleProviderError';
  }
}

export class GoogleSyncSchedulerAdapter implements GoogleSyncRetryScheduler {
  constructor(private readonly client = new SchedulerClient({})) {}
  private name(meetingId: string, revision: number, attempt: number) {
    const digest = createHash('sha256').update(meetingId).digest('hex').slice(0, 20);
    return `campusmeet-google-${digest}-r${revision}-a${attempt}`;
  }
  async schedule(input: {
    meetingId: string;
    syncRevision: number;
    attemptCount: number;
    runAt: string;
  }) {
    const name = this.name(input.meetingId, input.syncRevision, input.attemptCount);
    const schedule = {
      Name: name,
      ScheduleExpression: `at(${input.runAt.replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: 'OFF' as const },
      ActionAfterCompletion: 'DELETE' as const,
      Target: {
        Arn: required('GOOGLE_SYNC_WORKER_ARN'),
        RoleArn: required('GOOGLE_SYNC_SCHEDULER_ROLE_ARN'),
        Input: JSON.stringify({ meetingId: input.meetingId, syncRevision: input.syncRevision }),
        RetryPolicy: { MaximumRetryAttempts: 0 },
      },
    };
    try {
      await this.client.send(new CreateScheduleCommand({ ...schedule, ClientToken: name }));
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ConflictException') throw error;
      await this.client.send(new UpdateScheduleCommand(schedule));
    }
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
