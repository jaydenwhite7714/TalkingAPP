// TalkingApp — roles and permissions
//
// Every server has members, and every member has exactly one role. Roles decide
// what you are allowed to change, so people can never edit a server, channel or
// other person's message unless they were given the power to do it.
//
// This module is deliberately free of app state: hand it a server and a user id
// and it answers. That keeps the rules unit-testable and impossible to bypass
// from the UI layer by accident.

export const CAP = {
  manageServer: 'manageServer',     // rename, icon, colour, delete
  manageChannels: 'manageChannels', // create, rename, reorder, delete channels
  manageRoles: 'manageRoles',       // give other people a role
  manageMessages: 'manageMessages', // delete or pin anyone's message
  manageInvites: 'manageInvites',   // rotate invite code / lock the server
  sendMessages: 'sendMessages',
  react: 'react',
  invite: 'invite',
};

export const ROLE_ORDER = ['owner', 'admin', 'moderator', 'member', 'readonly'];

export const ROLES = {
  owner: {
    id: 'owner',
    label: 'Owner',
    short: 'OWNER',
    rank: 5,
    color: '#f0b232',
    desc: 'Everything, including deleting the server and handing out admin.',
    caps: [CAP.manageServer, CAP.manageChannels, CAP.manageRoles, CAP.manageMessages, CAP.manageInvites, CAP.sendMessages, CAP.react, CAP.invite],
  },
  admin: {
    id: 'admin',
    label: 'Admin',
    short: 'ADMIN',
    rank: 4,
    color: '#eb459e',
    desc: 'Runs the place: channels, roles, messages and invites.',
    caps: [CAP.manageServer, CAP.manageChannels, CAP.manageRoles, CAP.manageMessages, CAP.manageInvites, CAP.sendMessages, CAP.react, CAP.invite],
  },
  moderator: {
    id: 'moderator',
    label: 'Moderator',
    short: 'MOD',
    rank: 3,
    color: '#3ba55d',
    desc: 'Keeps conversations tidy: pins and removes messages.',
    caps: [CAP.manageMessages, CAP.sendMessages, CAP.react, CAP.invite],
  },
  member: {
    id: 'member',
    label: 'Member',
    short: 'MEMBER',
    rank: 2,
    color: '#8b95a5',
    desc: 'Can talk, react and invite friends.',
    caps: [CAP.sendMessages, CAP.react, CAP.invite],
  },
  readonly: {
    id: 'readonly',
    label: 'Read-only',
    short: 'READ',
    rank: 1,
    color: '#6b7280',
    desc: 'Can read everything but cannot post.',
    caps: [CAP.react],
  },
};

const CAPS_BY_ROLE = Object.fromEntries(Object.entries(ROLES).map(([id, r]) => [id, new Set(r.caps)]));

export function isRoleId(id) {
  return Object.prototype.hasOwnProperty.call(ROLES, id);
}

export function roleRecord(id) {
  return ROLES[isRoleId(id) ? id : 'member'];
}

/** The role id someone holds in a server. */
export function roleIdFor(server, userId) {
  if (!server || !userId) return 'member';
  if (server.ownerId && server.ownerId === userId) return 'owner';
  const assigned = server.members?.[userId]?.role;
  return isRoleId(assigned) ? assigned : 'member';
}

export function roleFor(server, userId) {
  return roleRecord(roleIdFor(server, userId));
}

/** Set of capabilities a user has in a server. */
export function capsFor(server, userId) {
  if (!server) return new Set();
  if (server.ownerId && server.ownerId === userId) return CAPS_BY_ROLE.owner;
  return CAPS_BY_ROLE[roleIdFor(server, userId)] || CAPS_BY_ROLE.member;
}

export function can(server, userId, capability) {
  if (!server || !userId) return false;
  // A server with no owner (the built-in starters) belongs to everybody: it can
  // be read and used, but nobody gets to redesign it.
  if (!server.ownerId) {
    return capability === CAP.sendMessages || capability === CAP.react || capability === CAP.invite;
  }
  return capsFor(server, userId).has(capability);
}

/** Can this person post in this channel? Announcement channels are staff-only. */
export function canPostIn(server, channel, userId) {
  if (!channel) return false;
  if (channel.type === 'dm') return true;
  if (channel.readOnly === true) return false;
  if (!server) return false;
  if (!can(server, userId, CAP.sendMessages)) return false;
  if (channel.type === 'announcement') return can(server, userId, CAP.manageMessages);
  return true;
}

/** Roles one person is allowed to hand to another. */
export function assignableRoles(server, actorId) {
  const actorRole = roleIdFor(server, actorId);
  if (actorRole === 'owner') return ['admin', 'moderator', 'member', 'readonly'];
  if (actorRole === 'admin') return ['moderator', 'member', 'readonly'];
  return [];
}

export function roleChipHTML(roleId, { withLabel = true } = {}) {
  const role = roleRecord(roleId);
  const label = withLabel ? role.short : '';
  return `<span class="role-chip" data-role="${role.id}" style="--role-color:${role.color}" title="${role.label}">${label}</span>`;
}
