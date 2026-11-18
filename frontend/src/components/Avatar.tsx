import type { User } from '../data/types'

export function Avatar({
  user,
  size = 'normal',
}: {
  user: User
  size?: 'small' | 'normal' | 'large'
}) {
  return (
    <span className={'avatar ' + user.tone + ' ' + size}>
      {user.initials}
      <i className={'status ' + user.status} />
    </span>
  )
}