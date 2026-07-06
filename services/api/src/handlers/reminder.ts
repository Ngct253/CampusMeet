import type { Handler } from 'aws-lambda';
export const reminderHandler: Handler = async () => {
  // TODO(M5): re-check meeting status, create in-app notification, then optionally send email.
  return { status: 'NOT_IMPLEMENTED' };
};
