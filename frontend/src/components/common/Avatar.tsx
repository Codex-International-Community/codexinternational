import type { User } from '../../types/chat'

interface AvatarProps {
  user: User
  size?: 'small' | 'normal' | 'large'
}

export function Avatar({ user, size = 'normal' }: AvatarProps) {
  return (
    <span className={`avatar ${user.tone} ${size}`}>
      {user.initials}
      <i className={`status ${user.status}`} />
    </span>
  )
}
