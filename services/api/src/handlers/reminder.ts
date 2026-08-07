import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { NotificationType } from '@campusmeet/shared';
import type { Handler } from 'aws-lambda';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbIdentityRepository } from '../repositories/identity';
import { ServiceConfigurationError } from '../utils/errors';

interface ReminderEvent {
  reminderId: string;
  meetingId: string;
}

const parseEvent = (value: unknown): ReminderEvent => {
  if (!value || typeof value !== 'object') throw new Error('INVALID_REMINDER_EVENT');
  const event = value as Record<string, unknown>;
  if (typeof event.reminderId !== 'string' || typeof event.meetingId !== 'string') {
    throw new Error('INVALID_REMINDER_EVENT');
  }
  return { reminderId: event.reminderId, meetingId: event.meetingId };
};

interface ReminderDependencies {
  meetings: Pick<DynamoDbMeetingRepository, 'getById'>;
  identities: Pick<DynamoDbIdentityRepository, 'getProfiles' | 'createNotification'>;
  email: Pick<SESv2Client, 'send'>;
}

export const createReminderHandler = (dependencies: ReminderDependencies = {
  meetings: new DynamoDbMeetingRepository(),
  identities: new DynamoDbIdentityRepository(),
  email: new SESv2Client({}),
}): Handler => async (untrustedEvent) => {
  const event = parseEvent(untrustedEvent);
  const meeting = await dependencies.meetings.getById(event.meetingId);
  if (!meeting || meeting.status === 'CANCELLED') {
    return { status: 'SKIPPED', reason: meeting ? 'MEETING_CANCELLED' : 'MEETING_NOT_FOUND' };
  }

  const recipientIds = [...new Set([meeting.organizerId, ...meeting.attendeeIds])];
  const profiles = await dependencies.identities.getProfiles(recipientIds);
  const createdAt = new Date().toISOString();
  let emailSent = 0;
  let emailFailed = 0;

  for (const userId of recipientIds) {
    await dependencies.identities.createNotification({
      id: `reminder-${event.reminderId}-${userId}`,
      userId,
      type: NotificationType.MEETING_REMINDER,
      title: `Sắp đến giờ họp: ${meeting.title}`,
      read: false,
      createdAt,
      actionUrl: `/app/meetings/${meeting.id}`,
    });

    const profile = profiles.get(userId);
    if (!profile?.emailNotificationsEnabled) continue;
    const fromEmail = process.env.SES_FROM_EMAIL;
    if (!fromEmail) throw new ServiceConfigurationError('Thiếu cấu hình SES_FROM_EMAIL.');
    try {
      await dependencies.email.send(
        new SendEmailCommand({
          FromEmailAddress: fromEmail,
          ConfigurationSetName: process.env.SES_CONFIGURATION_SET,
          Destination: { ToAddresses: [profile.email] },
          Content: {
            Simple: {
              Subject: { Data: `CampusMeet: ${meeting.title}`, Charset: 'UTF-8' },
              Body: {
                Text: {
                  Data: `Cuộc họp “${meeting.title}” bắt đầu lúc ${meeting.startsAt}.`,
                  Charset: 'UTF-8',
                },
              },
            },
          },
        }),
      );
      emailSent += 1;
    } catch (error) {
      emailFailed += 1;
      console.error('Reminder email failed', {
        reminderId: event.reminderId,
        meetingId: meeting.id,
        userId,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
    }
  }

  return { status: 'DELIVERED', notifications: recipientIds.length, emailSent, emailFailed };
};

export const reminderHandler = createReminderHandler();
