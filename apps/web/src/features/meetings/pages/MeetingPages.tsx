import { useParams } from 'react-router-dom';
import { FeaturePage } from '../../../components/FeaturePage';
import { StatusBadge } from '../../../components/ui';
import { mockMeetings } from '../../../mocks/data';

export function GroupMeetingsPage() {
  const { groupId } = useParams();
  return (
    <FeaturePage
      title="Lịch họp của nhóm"
      description={`Danh sách cuộc họp thuộc nhóm ${groupId}.`}
      backTo={`/app/groups/${groupId}`}
      backLabel="Quay lại"
      todo="M2/M4 nối meeting API và integration status."
    >
      <div className="list">
        {mockMeetings.map((meeting) => (
          <article key={meeting.id}>
            <strong>{meeting.title}</strong> <StatusBadge>{meeting.integrationStatus}</StatusBadge>
            <p>{new Date(meeting.startsAt).toLocaleString('vi-VN')}</p>
          </article>
        ))}
      </div>
    </FeaturePage>
  );
}

export function MeetingDetailPage() {
  const { meetingId } = useParams();
  return (
    <FeaturePage
      title="Chi tiết cuộc họp"
      description={`Agenda, người tham dự và biên bản cho ${meetingId}.`}
      backTo="/app/dashboard"
      backLabel="Quay lại"
      todo="M3/M4 nối meeting/minutes API; chỉ hiện Meet URL khi READY."
    />
  );
}
