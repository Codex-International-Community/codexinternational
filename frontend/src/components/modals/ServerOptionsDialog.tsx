import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useDelayedLoading } from '../../hooks/useDelayedLoading'
import { Icon } from '../common/Icon'
import type { IconName } from '../../types/common'
import {
  createCommunityRole,
  deleteCommunityCategory,
  deleteCommunityRole,
  getCommunityInvite,
  listChannels,
  listCommunityCategories,
  listCommunityEvents,
  listCommunityMembers,
  listCommunityRoles,
  updateCommunityMemberRole,
  updateCommunityRole,
  type ChannelSummary,
  type CommunityCategory,
  type CommunityEvent,
  type CommunityMemberSummary,
  type CommunityRole,
} from '../../api/communities'

export type ServerOptionsDialogMode =
  | 'settings'
  | 'category'
  | 'event'
  | 'notifications'
  | 'privacy'
  | 'profile'

type ServerSettingsSection = 'overview' | 'members' | 'channels' | 'roles' | 'invites' | 'events' | 'danger'

export interface ServerOptionsDialogProps {
  mode: ServerOptionsDialogMode
  serverName: string
  communityId: string
  currentUserId: string
  isOwner: boolean
  canManageRoles: boolean
  name: string
  description: string
  isPublic: boolean
  startsAt: string
  location: string
  notificationMode: 'all' | 'mentions' | 'none'
  serverMuted: boolean
  allowDirectMessages: boolean
  allowMessageRequests: boolean
  hideMutedChannels: boolean
  nickname: string
  busy: boolean
  error: string
  onChangeName: (value: string) => void
  onChangeDescription: (value: string) => void
  onChangePublic: (value: boolean) => void
  onChangeStartsAt: (value: string) => void
  onChangeLocation: (value: string) => void
  onChangeNotificationMode: (value: 'all' | 'mentions' | 'none') => void
  onChangeServerMuted: (value: boolean) => void
  onChangeAllowDirectMessages: (value: boolean) => void
  onChangeAllowMessageRequests: (value: boolean) => void
  onChangeHideMutedChannels: (value: boolean) => void
  onChangeNickname: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onCreateChannel: () => void
  onCreateCategory: () => void
  onCreateEvent: () => void
  onDeleteServer: () => void
  onLeaveServer: () => void
  onClose: () => void
}

const dialogCopy: Record<Exclude<ServerOptionsDialogMode, 'settings'>, { title: string; description: string; action: string }> = {
  category: {
    title: 'Create Category',
    description: 'Group related channels together in your server.',
    action: 'Create Category',
  },
  event: {
    title: 'Create Event',
    description: 'Schedule a time for your server members to meet.',
    action: 'Create Event',
  },
  notifications: {
    title: 'Notification Settings',
    description: 'Choose which server activity should notify you.',
    action: 'Save Preferences',
  },
  privacy: {
    title: 'Privacy Settings',
    description: 'Control how members of this server can contact you.',
    action: 'Save Preferences',
  },
  profile: {
    title: 'Edit Server Profile',
    description: 'Set the nickname other members see in this server.',
    action: 'Save Nickname',
  },
}

function ToggleRow({
  checked,
  title,
  description,
  onChange,
  disabled = false,
}: {
  checked: boolean
  title: string
  description: string
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="server-options-toggle">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

function initialsFor(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function formatEventDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function ServerOptionsDialog(props: ServerOptionsDialogProps) {
  const {
    mode,
    serverName,
    communityId,
    currentUserId,
    isOwner,
    canManageRoles,
    name,
    description,
    isPublic,
    startsAt,
    location,
    notificationMode,
    serverMuted,
    allowDirectMessages,
    allowMessageRequests,
    hideMutedChannels,
    nickname,
    busy,
    error,
    onChangeName,
    onChangeDescription,
    onChangePublic,
    onChangeStartsAt,
    onChangeLocation,
    onChangeNotificationMode,
    onChangeServerMuted,
    onChangeAllowDirectMessages,
    onChangeAllowMessageRequests,
    onChangeHideMutedChannels,
    onChangeNickname,
    onSubmit,
    onCreateChannel,
    onCreateCategory,
    onCreateEvent,
    onDeleteServer,
    onLeaveServer,
    onClose,
  } = props

  const titleId = useId()
  const [activeSection, setActiveSection] = useState<ServerSettingsSection>('overview')
  const [members, setMembers] = useState<CommunityMemberSummary[]>([])
  const [roles, setRoles] = useState<CommunityRole[]>([])
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  const [categories, setCategories] = useState<CommunityCategory[]>([])
  const [events, setEvents] = useState<CommunityEvent[]>([])
  const [inviteCode, setInviteCode] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const showLoading = useDelayedLoading(loading, 5000)
  const [loadError, setLoadError] = useState('')
  const [localMessage, setLocalMessage] = useState('')
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [roleName, setRoleName] = useState('')
  const [roleColor, setRoleColor] = useState('#6B8DFF')
  const [rolePermissions, setRolePermissions] = useState(0)
  const [roleBusy, setRoleBusy] = useState(false)
  const permissionOptions: { bit: number; label: string; ownerOnly?: boolean }[] = [
    { bit: 1, label: 'View Channels' },
    { bit: 2, label: 'Send Messages' },
    { bit: 4, label: 'Manage Messages' },
    { bit: 8, label: 'Mention @everyone' },
    { bit: 16, label: 'Manage Channels' },
    { bit: 32, label: 'Manage Roles' },
    { bit: 64, label: 'Moderate Contributions' },
    { bit: 128, label: 'Administrator', ownerOnly: true },
    { bit: 256, label: 'Moderate Members' },
  ]

  useEffect(() => {
    if (mode !== 'settings') return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    void Promise.all([
      listCommunityMembers(communityId),
      listCommunityRoles(communityId),
      listChannels(communityId),
      listCommunityCategories(communityId),
      listCommunityEvents(communityId),
      getCommunityInvite(communityId),
    ])
      .then(([memberRows, roleRows, channelRows, categoryRows, eventRows, invite]) => {
        if (cancelled) return
        setMembers(memberRows)
        setRoles(roleRows)
        setChannels(channelRows)
        setCategories(categoryRows)
        setEvents(eventRows)
        setInviteCode(invite.invite_code)
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        setLoadError(requestError instanceof Error ? requestError.message : 'Could not load server settings.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [communityId, mode])

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return members
    return members.filter((member) =>
      member.display_name.toLowerCase().includes(term)
      || member.username.toLowerCase().includes(term)
      || member.role_name.toLowerCase().includes(term),
    )
  }, [members, search])

  const groupedChannels = useMemo(
    () => categories.map((category) => ({
      ...category,
      channels: channels.filter((channel) => channel.category_id === category.id),
    })),
    [categories, channels],
  )
  const uncategorizedChannels = channels.filter((channel) => !channel.category_id)
  const inviteUrl = inviteCode
    ? `${window.location.origin}/invite/${encodeURIComponent(inviteCode)}`
    : ''

  const handleCopyInvite = async () => {
    try {
      if (!inviteUrl || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(inviteUrl)
      setLocalMessage('Invite link copied')
    } catch {
      setLocalMessage('Could not copy invite code. Check browser clipboard permissions.')
    }
  }

  const handleDeleteCategory = async (category: CommunityCategory) => {
    if (!window.confirm('Delete the ' + category.name + ' category? Channels inside it will become uncategorized.')) return
    try {
      await deleteCommunityCategory(communityId, category.id)
      setCategories((previous) => previous.filter((item) => item.id !== category.id))
      setChannels((previous) => previous.map((channel) => channel.category_id === category.id
        ? { ...channel, category_id: null, category_name: null }
        : channel))
      setLocalMessage('Category deleted')
    } catch (requestError) {
      setLocalMessage(requestError instanceof Error ? requestError.message : 'Could not delete category.')
    }
  }

  const startRoleEdit = (role: CommunityRole) => {
    setEditingRoleId(role.id)
    setRoleName(role.name)
    setRoleColor(role.color)
    setRolePermissions(role.permissions)
    setLocalMessage('')
  }

  const resetRoleEditor = () => {
    setEditingRoleId(null)
    setRoleName('')
    setRoleColor('#6B8DFF')
    setRolePermissions(0)
  }

  const saveRole = async () => {
    if (!roleName.trim() || roleBusy) return
    setRoleBusy(true)
    setLocalMessage('')
    try {
      const payload = { name: roleName.trim(), color: roleColor, permissions: rolePermissions }
      const saved = editingRoleId
        ? await updateCommunityRole(communityId, editingRoleId, payload)
        : await createCommunityRole(communityId, payload)
      setRoles((previous) => {
        const next = previous.filter((item) => item.id !== saved.id)
        return [...next, saved].sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
      })
      resetRoleEditor()
      setLocalMessage(editingRoleId ? 'Role updated' : 'Role created')
    } catch (requestError) {
      setLocalMessage(requestError instanceof Error ? requestError.message : 'Could not save role.')
    } finally {
      setRoleBusy(false)
    }
  }

  const removeRole = async (role: CommunityRole) => {
    if (!window.confirm('Delete the ' + role.name + ' role? Members assigned to it will be moved to @everyone.')) return
    try {
      await deleteCommunityRole(communityId, role.id)
      const fallback = roles.find((item) => item.is_default)
      setRoles((previous) => previous.filter((item) => item.id !== role.id))
      if (fallback) {
        setMembers((previous) => previous.map((member) => member.role_id === role.id
          ? { ...member, role_id: fallback.id, role_name: fallback.name }
          : member))
      }
      if (editingRoleId === role.id) resetRoleEditor()
      setLocalMessage('Role deleted')
    } catch (requestError) {
      setLocalMessage(requestError instanceof Error ? requestError.message : 'Could not delete role.')
    }
  }

  const assignMemberRole = async (member: CommunityMemberSummary, roleId: string) => {
    try {
      const role = await updateCommunityMemberRole(communityId, member.id, roleId || null)
      setMembers((previous) => previous.map((item) => item.id === member.id
        ? { ...item, role_id: role.id, role_name: role.name }
        : item))
      setLocalMessage('Updated role for ' + member.display_name)
    } catch (requestError) {
      setLocalMessage(requestError instanceof Error ? requestError.message : 'Could not update member role.')
    }
  }

  if (mode === 'settings') {
    const sections: { id: ServerSettingsSection; label: string; icon: IconName }[] = [
      { id: 'overview', label: 'Overview', icon: 'settings' },
      { id: 'members', label: 'Members', icon: 'users' },
      { id: 'channels', label: 'Channels', icon: 'hash' },
      { id: 'roles', label: 'Roles', icon: 'shield' },
      { id: 'invites', label: 'Invites', icon: 'link' },
      { id: 'events', label: 'Events', icon: 'calendar' },
    ]

    return (
      <div className="server-settings-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <aside className="server-settings-sidebar">
          <div className="server-settings-sidebar-top">
            <span className="server-settings-kicker">SERVER SETTINGS</span>
            <button type="button" className="server-settings-close-mobile" aria-label="Close settings" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="server-settings-server">
            <span className="server-settings-server-mark">{initialsFor(serverName) || 'S'}</span>
            <span>
              <strong>{serverName}</strong>
              <small>Community management</small>
            </span>
          </div>
          <nav className="server-settings-nav" aria-label="Server settings sections">
            <span className="server-settings-nav-label">SERVER</span>
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSection === section.id ? 'is-active' : ''}
                aria-current={activeSection === section.id ? 'page' : undefined}
                onClick={() => {
                  setActiveSection(section.id)
                  setLocalMessage('')
                }}
              >
                <Icon name={section.icon} size={17} />
                <span>{section.label}</span>
                {section.id === 'members' && <small>{members.length}</small>}
                {section.id === 'channels' && <small>{channels.length}</small>}
              </button>
            ))}
            <span className="server-settings-nav-label server-settings-nav-label--spaced">MANAGEMENT</span>
            <button
              type="button"
              className={'server-settings-nav-danger' + (activeSection === 'danger' ? ' is-active' : '')}
              aria-current={activeSection === 'danger' ? 'page' : undefined}
              onClick={() => {
                setActiveSection('danger')
                setLocalMessage('')
              }}
            >
              <Icon name="trash" size={17} />
              <span>Danger Zone</span>
            </button>
          </nav>
          <div className="server-settings-sidebar-bottom">
            <button type="button" onClick={onClose}>
              <Icon name="arrow" size={15} />
              Back to server
            </button>
          </div>
        </aside>

        <main className="server-settings-main">
          <header className="server-settings-topbar">
            <div>
              <span className="server-settings-breadcrumb">SERVER SETTINGS <Icon name="chevron" size={12} /> {activeSection.toUpperCase()}</span>
              <h2 id={titleId}>{sections.find((item) => item.id === activeSection)?.label ?? 'Danger Zone'}</h2>
            </div>
            <button type="button" className="server-settings-close" aria-label="Close settings" onClick={onClose}>
              <Icon name="close" size={19} />
            </button>
          </header>

          <div className="server-settings-content">
            {showLoading && <div className="server-settings-feedback" role="status">Loading server data…</div>}
            {loadError && <div className="server-settings-error" role="alert">{loadError}</div>}
            {localMessage && <div className="server-settings-feedback" role="status">{localMessage}</div>}

            {activeSection === 'overview' && (
              <section className="server-settings-section">
                <div className="server-settings-section-heading">
                  <div>
                    <span className="server-settings-eyebrow">SERVER PROFILE</span>
                    <h3>Overview</h3>
                    <p>Update how this server is presented to its members and people discovering communities.</p>
                  </div>
                </div>
                <div className="server-settings-summary">
                  <div className="server-settings-summary-icon">{initialsFor(name || serverName) || 'S'}</div>
                  <div className="server-settings-summary-copy">
                    <strong>{name || serverName}</strong>
                    <span>{members.length} {members.length === 1 ? 'member' : 'members'} · {channels.length} {channels.length === 1 ? 'channel' : 'channels'}</span>
                  </div>
                  <span className={'server-settings-visibility ' + (isPublic ? 'is-public' : 'is-private')}>
                    <Icon name={isPublic ? 'compass' : 'eyeOff'} size={14} />
                    {isPublic ? 'Public' : 'Private'}
                  </span>
                </div>
                <form className="server-settings-form" onSubmit={onSubmit}>
                  <div className="server-settings-field">
                    <label htmlFor="server-options-name">SERVER NAME</label>
                    <input id="server-options-name" value={name} maxLength={100} onChange={(event) => onChangeName(event.target.value)} disabled={!isOwner} />
                    <small>Choose a recognizable name for your community.</small>
                  </div>
                  <div className="server-settings-field">
                    <label htmlFor="server-options-description">DESCRIPTION</label>
                    <textarea id="server-options-description" value={description} maxLength={2000} rows={4} onChange={(event) => onChangeDescription(event.target.value)} disabled={!isOwner} />
                    <small>{description.length}/2000 characters</small>
                  </div>
                  <div className="server-settings-preference">
                    <ToggleRow checked={isPublic} disabled={!isOwner} title="Public server" description="Allow this server to appear in public community discovery." onChange={onChangePublic} />
                  </div>
                  {!isOwner && <p className="server-settings-note">Only the server owner can edit its name, description, and visibility.</p>}
                  {error && <p className="server-options-error" role="alert">{error}</p>}
                  {isOwner && (
                    <div className="server-settings-form-actions">
                      <button type="submit" className="server-settings-primary" disabled={busy || !name.trim()}>
                        {busy ? 'Saving…' : 'Save Changes'}
                      </button>
                    </div>
                  )}
                </form>
              </section>
            )}

            {activeSection === 'members' && (
              <section className="server-settings-section">
                <div className="server-settings-section-heading server-settings-section-heading--row">
                  <div>
                    <span className="server-settings-eyebrow">COMMUNITY</span>
                    <h3>Members</h3>
                    <p>People who currently belong to this server.</p>
                  </div>
                  <span className="server-settings-count">{members.length} TOTAL</span>
                </div>
                <label className="server-settings-search">
                  <Icon name="search" size={16} />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search members or roles…" />
                </label>
                <div className="server-settings-list">
                  {filteredMembers.map((member) => (
                    <div className="server-settings-member" key={member.id}>
                      <span className="server-settings-member-avatar">{initialsFor(member.display_name) || 'U'}</span>
                      <span className="server-settings-member-copy">
                        <strong>{member.display_name}</strong>
                        <small>@{member.username}</small>
                      </span>
                      <span className={'server-settings-status' + (member.online ? ' is-online' : '')}>
                        <i />
                        {member.online ? 'Online' : 'Offline'}
                      </span>
                      {canManageRoles ? (
                        <select
                          className="server-settings-role-select"
                          aria-label={`Role for ${member.display_name}`}
                          value={member.role_id ?? roles.find((role) => role.is_default)?.id ?? ''}
                          disabled={member.is_owner || member.id === currentUserId}
                          onChange={(event) => void assignMemberRole(member, event.target.value)}
                        >
                          {roles.map((role) => (
                            <option key={role.id} value={role.id}>{role.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="server-settings-role">{member.role_name}</span>
                      )}
                    </div>
                  ))}
                  {!loading && filteredMembers.length === 0 && (
                    <div className="server-settings-empty">
                      <Icon name="users" size={23} />
                      <strong>{search ? 'No matching members' : 'No members found'}</strong>
                      <span>{search ? 'Try another name, username, or role.' : 'Member data is not available yet.'}</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeSection === 'channels' && (
              <section className="server-settings-section">
                <div className="server-settings-section-heading server-settings-section-heading--row">
                  <div>
                    <span className="server-settings-eyebrow">SERVER STRUCTURE</span>
                    <h3>Channels &amp; Categories</h3>
                    <p>Organize conversations into channels and channel groups.</p>
                  </div>
                  <div className="server-settings-heading-actions">
                    <button type="button" className="server-settings-secondary" onClick={onCreateCategory}>
                      <Icon name="plus" size={15} /> Category
                    </button>
                    <button type="button" className="server-settings-primary" onClick={onCreateChannel}>
                      <Icon name="plus" size={15} /> Channel
                    </button>
                  </div>
                </div>
                <div className="server-settings-channel-list">
                  {groupedChannels.map((category) => (
                    <div className="server-settings-category" key={category.id}>
                      <div className="server-settings-category-heading">
                        <strong>{category.name}</strong>
                        <span>{category.channels.length} CHANNELS</span>
                        {isOwner && (
                          <button type="button" aria-label={'Delete ' + category.name + ' category'} title="Delete category" onClick={() => void handleDeleteCategory(category)}>
                            <Icon name="trash" size={15} />
                          </button>
                        )}
                      </div>
                      {category.channels.map((channel) => (
                        <div className="server-settings-channel" key={channel.id}>
                          <Icon name="hash" size={16} />
                          <span>{channel.name ?? 'Unnamed channel'}</span>
                          <small>{channel.channel_type === 'announcement' ? 'Announcement' : 'Text channel'}</small>
                          {channel.is_private && <span className="server-settings-private">Private</span>}
                        </div>
                      ))}
                      {category.channels.length === 0 && <p className="server-settings-empty-inline">No channels in this category yet.</p>}
                    </div>
                  ))}
                  <div className="server-settings-category">
                    <div className="server-settings-category-heading">
                      <strong>Uncategorized</strong>
                      <span>{uncategorizedChannels.length} CHANNELS</span>
                    </div>
                    {uncategorizedChannels.map((channel) => (
                      <div className="server-settings-channel" key={channel.id}>
                        <Icon name="hash" size={16} />
                        <span>{channel.name ?? 'Unnamed channel'}</span>
                        <small>{channel.channel_type === 'announcement' ? 'Announcement' : 'Text channel'}</small>
                        {channel.is_private && <span className="server-settings-private">Private</span>}
                      </div>
                    ))}
                    {uncategorizedChannels.length === 0 && <p className="server-settings-empty-inline">No uncategorized channels.</p>}
                  </div>
                  {!loading && channels.length === 0 && categories.length === 0 && (
                    <div className="server-settings-empty">
                      <Icon name="hash" size={23} />
                      <strong>No channels yet</strong>
                      <span>Create a channel to start organizing conversations.</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeSection === 'roles' && (
              <section className="server-settings-section">
                <div className="server-settings-section-heading server-settings-section-heading--row">
                  <div>
                    <span className="server-settings-eyebrow">PERMISSIONS &amp; ACCESS</span>
                    <h3>Roles</h3>
                    <p>Create server roles, configure permissions, and control what members can do.</p>
                  </div>
                  {canManageRoles && (
                    <button type="button" className="server-settings-primary" onClick={() => { resetRoleEditor(); setLocalMessage('') }}>
                      <Icon name="plus" size={15} /> Create Role
                    </button>
                  )}
                </div>

                {canManageRoles && (
                  <div className="server-settings-role-editor">
                    <div className="server-settings-role-editor-heading">
                      <strong>{editingRoleId ? 'Edit role' : 'New role'}</strong>
                      <span>Permissions are enforced by the server API.</span>
                    </div>
                    <div className="server-settings-role-fields">
                      <label>
                        <span>ROLE NAME</span>
                        <input value={roleName} maxLength={50} placeholder="e.g. Moderator" onChange={(event) => setRoleName(event.target.value)} />
                      </label>
                      <label className="server-settings-role-color">
                        <span>ROLE COLOR</span>
                        <input type="color" value={roleColor} onChange={(event) => setRoleColor(event.target.value.toUpperCase())} />
                      </label>
                    </div>
                    <span className="server-settings-role-permissions-label">PERMISSIONS</span>
                    <div className="server-settings-permission-grid">
                      {permissionOptions.filter((option) => !option.ownerOnly || isOwner).map((option) => (
                        <label key={option.bit}>
                          <input
                            type="checkbox"
                            checked={(rolePermissions & option.bit) === option.bit}
                            onChange={(event) => setRolePermissions((current) => event.target.checked ? current | option.bit : current & ~option.bit)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="server-settings-role-editor-actions">
                      {editingRoleId && <button type="button" className="server-settings-secondary" onClick={resetRoleEditor}>Cancel</button>}
                      <button type="button" className="server-settings-primary" disabled={roleBusy || !roleName.trim()} onClick={() => void saveRole()}>
                        {roleBusy ? 'Saving…' : editingRoleId ? 'Save Role' : 'Create Role'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="server-settings-role-list">
                  {roles.map((role) => {
                    const activePermissionNames = permissionOptions.filter((option) => (role.permissions & option.bit) === option.bit).map((option) => option.label)
                    return (
                      <article className="server-settings-role-card" key={role.id}>
                        <span className="server-settings-role-color-dot" style={{ background: role.color }} />
                        <div className="server-settings-role-card-copy">
                          <strong>{role.name}</strong>
                          <small>{role.is_default ? 'Default role' : `Position ${role.position}`} · {activePermissionNames.length} permissions</small>
                          <div className="server-settings-role-badges">
                            {activePermissionNames.length > 0
                              ? activePermissionNames.map((permission) => <span key={permission}>{permission}</span>)
                              : <span>No additional permissions</span>}
                          </div>
                        </div>
                        {!role.is_default && canManageRoles && (
                          <div className="server-settings-role-card-actions">
                            <button type="button" aria-label={`Edit ${role.name}`} onClick={() => startRoleEdit(role)}>
                              <Icon name="edit" size={15} />
                            </button>
                            {canManageRoles && (
                              <button type="button" aria-label={`Delete ${role.name}`} onClick={() => void removeRole(role)}>
                                <Icon name="trash" size={15} />
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    )
                  })}
                  {!loading && roles.length === 0 && (
                    <div className="server-settings-empty">
                      <Icon name="shield" size={23} />
                      <strong>No roles found</strong>
                      <span>The server role list could not be loaded.</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeSection === 'invites' && (
              <section className="server-settings-section">
                <div className="server-settings-section-heading">
                  <span className="server-settings-eyebrow">GROW YOUR COMMUNITY</span>
                  <h3>Invites</h3>
                  <p>Share this invite link with people you want to bring into the server.</p>
                </div>
                <div className="server-settings-invite-card">
                  <span className="server-settings-eyebrow">SERVER INVITE LINK</span>
                  <div className="server-settings-invite-code">
                    <code>{inviteUrl || (loading ? 'Loading…' : 'Unavailable')}</code>
                    <button type="button" onClick={() => void handleCopyInvite()} disabled={!inviteUrl}>
                      <Icon name="copy" size={16} /> Copy link
                    </button>
                  </div>
                  <p>Anyone with this code can join, unless they are banned from this server.</p>
                </div>
              </section>
            )}

            {activeSection === 'events' && (
              <section className="server-settings-section">
                <div className="server-settings-section-heading server-settings-section-heading--row">
                  <div>
                    <span className="server-settings-eyebrow">COMMUNITY ACTIVITY</span>
                    <h3>Events</h3>
                    <p>Upcoming gatherings and scheduled community activities.</p>
                  </div>
                  <button type="button" className="server-settings-primary" onClick={onCreateEvent}>
                    <Icon name="plus" size={15} /> Create Event
                  </button>
                </div>
                <div className="server-settings-event-list">
                  {events.map((event) => (
                    <article className="server-settings-event" key={event.id}>
                      <div className="server-settings-event-date">
                        <Icon name="calendar" size={19} />
                      </div>
                      <div>
                        <strong>{event.name}</strong>
                        <span>{formatEventDate(event.starts_at)}</span>
                        {event.description && <p>{event.description}</p>}
                        {event.location && <small>{event.location}</small>}
                      </div>
                    </article>
                  ))}
                  {!loading && events.length === 0 && (
                    <div className="server-settings-empty">
                      <Icon name="calendar" size={23} />
                      <strong>No upcoming events</strong>
                      <span>Schedule a meetup or activity for your members.</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeSection === 'danger' && (
              <section className="server-settings-section">
                <div className="server-settings-section-heading">
                  <span className="server-settings-eyebrow">IRREVERSIBLE ACTIONS</span>
                  <h3>Danger Zone</h3>
                  <p>These actions affect your membership or permanently remove this server.</p>
                </div>
                {isOwner ? (
                  <div className="server-settings-danger-card">
                    <div>
                      <strong>Delete this server</strong>
                      <p>Permanently delete the server, its channels, messages, members, and community data. This cannot be undone.</p>
                    </div>
                    <button type="button" onClick={onDeleteServer}>Delete Server</button>
                  </div>
                ) : (
                  <div className="server-settings-danger-card">
                    <div>
                      <strong>Leave this server</strong>
                      <p>You will lose access to its channels and will need a new invite to join again.</p>
                    </div>
                    <button type="button" onClick={onLeaveServer}>Leave Server</button>
                  </div>
                )}
              </section>
            )}
          </div>
        </main>
      </div>
    )
  }

  const copy = dialogCopy[mode]

  return (
    <div className="server-options-overlay" onMouseDown={onClose}>
      <section
        className="server-options-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form className="server-options-form" onSubmit={onSubmit}>
          <header className="server-options-header">
            <div>
              <span className="eyebrow">{serverName}</span>
              <h2 id={titleId}>{copy.title}</h2>
              <p>{copy.description}</p>
            </div>
            <button type="button" aria-label="Close dialog" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </header>

          {mode === 'category' && (
            <>
              <label htmlFor="server-options-name">CATEGORY NAME</label>
              <input id="server-options-name" value={name} maxLength={100} placeholder="e.g. PROJECTS" onChange={(event) => onChangeName(event.target.value)} autoFocus />
            </>
          )}

          {mode === 'event' && (
            <>
              <label htmlFor="server-options-name">EVENT NAME</label>
              <input id="server-options-name" value={name} maxLength={100} placeholder="e.g. Weekly community meetup" onChange={(event) => onChangeName(event.target.value)} autoFocus />
              <label htmlFor="server-options-description">DESCRIPTION</label>
              <textarea id="server-options-description" value={description} maxLength={2000} rows={3} onChange={(event) => onChangeDescription(event.target.value)} />
              <label htmlFor="server-options-starts">STARTS AT</label>
              <input id="server-options-starts" type="datetime-local" value={startsAt} onChange={(event) => onChangeStartsAt(event.target.value)} />
              <label htmlFor="server-options-location">LOCATION OR CHANNEL</label>
              <input id="server-options-location" value={location} maxLength={200} placeholder="e.g. #general or a meeting link" onChange={(event) => onChangeLocation(event.target.value)} />
            </>
          )}

          {mode === 'notifications' && (
            <>
              <label htmlFor="server-options-notifications">DEFAULT NOTIFICATIONS</label>
              <select id="server-options-notifications" value={notificationMode} onChange={(event) => onChangeNotificationMode(event.target.value as 'all' | 'mentions' | 'none')}>
                <option value="all">All Messages</option>
                <option value="mentions">Only @mentions</option>
                <option value="none">Nothing</option>
              </select>
              <ToggleRow checked={serverMuted} title="Mute server" description="Silence all notifications from this server." onChange={onChangeServerMuted} />
              <ToggleRow checked={hideMutedChannels} title="Hide muted channels" description="Hide muted channels from the server channel list." onChange={onChangeHideMutedChannels} />
            </>
          )}

          {mode === 'privacy' && (
            <>
              <ToggleRow checked={allowDirectMessages} title="Direct messages" description="Allow members of this server to send you direct messages." onChange={onChangeAllowDirectMessages} />
              <ToggleRow checked={allowMessageRequests} title="Message requests" description="Filter direct messages from server members you may not know." onChange={onChangeAllowMessageRequests} />
            </>
          )}

          {mode === 'profile' && (
            <>
              <label htmlFor="server-options-nickname">SERVER NICKNAME</label>
              <input id="server-options-nickname" value={nickname} maxLength={64} placeholder="Use your account display name" onChange={(event) => onChangeNickname(event.target.value)} autoFocus />
              <small className="server-options-hint">Leave this blank to use your account display name.</small>
            </>
          )}

          {error && <p className="server-options-error" role="alert">{error}</p>}
          <footer className="server-options-actions">
            <button type="button" className="server-options-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="server-options-save" disabled={busy || (mode === 'category' && !name.trim()) || (mode === 'event' && (!name.trim() || !startsAt))}>
              {busy ? 'Saving…' : copy.action}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
