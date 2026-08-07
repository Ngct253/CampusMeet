import { meet, type MeetingInfo } from '@googleworkspace/meet-addons/meet.addons';

export async function getMeetAddonMeetingInfo(): Promise<MeetingInfo> {
  const cloudProjectNumber = import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER as
    | string
    | undefined;
  if (!cloudProjectNumber) {
    throw new Error('Thiếu VITE_GOOGLE_CLOUD_PROJECT_NUMBER.');
  }
  const session = await meet.addon.createAddonSession({ cloudProjectNumber });
  const sidePanel = await session.createSidePanelClient();
  return sidePanel.getMeetingInfo();
}
