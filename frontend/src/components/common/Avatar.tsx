import type { User } from '../../types/chat'
import { publicApiUrl } from '../../api/client'

interface AvatarProps {
  user: User
  size?: 'small' | 'normal' | 'large'
}

export function Avatar({ user, size = 'normal' }: AvatarProps) {
  return (
    <span className={`avatar ${user.tone} ${size}`}>
      {user.avatarMediaId ? (
        <img className="avatar-photo" src={publicApiUrl(`/api/v1/media/avatar/${encodeURIComponent(user.avatarMediaId)}`)} alt="" draggable={false} />
      ) : user.initials}
      <i className={`status ${user.status}`} />
    </span>
  )
}
