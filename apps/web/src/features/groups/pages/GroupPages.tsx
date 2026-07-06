import { useParams } from 'react-router-dom';
import { FeaturePage } from '../../../components/FeaturePage';
import { mockGroups } from '../../../mocks/data';

export const GroupsPage = () => (
  <FeaturePage
    title="Nhóm của tôi"
    description="Các nhóm học tập và đồ án bạn đang tham gia."
    todo="M2/M3 nối API groups và membership."
  >
    <div className="list">
      {mockGroups.map((group) => (
        <article key={group.id}>
          <strong>{group.name}</strong>
          <p>{group.description}</p>
        </article>
      ))}
    </div>
  </FeaturePage>
);

export function GroupDetailPage() {
  const { groupId } = useParams();
  return (
    <FeaturePage
      title="Chi tiết nhóm"
      description={`Thông tin khung cho nhóm ${groupId}.`}
      todo="M2 triển khai membership và dashboard nhóm."
    />
  );
}
