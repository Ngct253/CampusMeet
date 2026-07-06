import type { Meeting } from '@campusmeet/shared';
import type {
  EmailGateway,
  GoogleCalendarGateway,
  ReminderSchedulerGateway,
} from '../domain/ports';
import { NotImplementedError } from '../utils/errors';

export class GoogleCalendarAdapter implements GoogleCalendarGateway {
  createEvent(_meeting: Meeting): Promise<{ eventId: string; meetUrl?: string }> {
    // TODO(M4): use a server-side token and Calendar conferenceDataVersion=1; map pending/failure states.
    throw new NotImplementedError('Google Calendar adapter is not implemented');
  }
}

export class EventBridgeSchedulerAdapter implements ReminderSchedulerGateway {
  schedule(_meeting: Meeting): Promise<{ scheduleId: string }> {
    // TODO(M5): create an idempotent one-time schedule targeting Reminder Lambda.
    throw new NotImplementedError('EventBridge Scheduler adapter is not implemented');
  }
}

export class SesEmailAdapter implements EmailGateway {
  send(_to: string, _subject: string, _body: string): Promise<void> {
    // TODO(M5): send optional email without making in-app notification delivery depend on SES.
    throw new NotImplementedError('SES email adapter is not implemented');
  }
}
