// TalkingApp — plans (the "subscription" system)
//
// A deliberately simple tier system: everyone starts on Free, and there are two
// paid-looking tiers with bigger limits and a badge next to your name. There is
// no checkout and no money anywhere — switching plans is instant and local, and
// the app says so plainly wherever plans are shown.
//
// Plans travel with your account (they live in your saved settings), so they
// follow you to another Chromebook along with everything else.

export const DEMO_NOTE = 'Demo plans — switching is instant, nothing is charged, and no card is ever asked for.';

export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    tagline: 'Everything you need to talk to people.',
    badge: { label: 'FREE', color: '#8b95a5' },
    limits: {
      servers: 4,
      channels: 12,
      uploadMB: 8,
      logEntries: 60,
      cloudKB: 1200,
      cloudChunks: 120,
    },
    perks: [
      'Unlimited messages and direct messages',
      'Servers, channels and roles',
      'Pictures and GIFs up to 8 MB',
      'Encrypted cloud copy of everything',
      '4 servers of your own',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    price: '$4',
    cadence: 'per month',
    tagline: 'For people who run a few rooms.',
    badge: { label: 'PLUS', color: '#8b6ff5' },
    limits: {
      servers: 25,
      channels: 40,
      uploadMB: 25,
      logEntries: 120,
      cloudKB: 3400,
      cloudChunks: 320,
    },
    perks: [
      'Everything in Free',
      '25 servers and 40 channels each',
      'Pictures and GIFs up to 25 MB',
      'A PLUS badge on your name',
      'Longer history in the shared log',
    ],
  },
  {
    id: 'studio',
    name: 'Studio',
    price: '$8',
    cadence: 'per month',
    tagline: 'For whole communities and classrooms.',
    badge: { label: 'STUDIO', color: '#f0b232' },
    limits: {
      servers: 100,
      channels: 120,
      uploadMB: 50,
      logEntries: 200,
      cloudKB: 6800,
      cloudChunks: 640,
    },
    perks: [
      'Everything in Plus',
      '100 servers and 120 channels each',
      'Pictures and GIFs up to 50 MB',
      'A STUDIO badge and the gold ring',
      'The deepest shared history',
    ],
  },
];

export const DEFAULT_PLAN = 'free';

const BY_ID = new Map(PLANS.map((p) => [p.id, p]));

export function planOf(id) {
  return BY_ID.get(id) || BY_ID.get(DEFAULT_PLAN);
}

export function isPlanId(id) {
  return BY_ID.has(id);
}

export function limitsFor(id) {
  return planOf(id).limits;
}

export function maxUploadBytes(id) {
  return limitsFor(id).uploadMB * 1024 * 1024;
}

/** How many servers you still have room for on a plan. */
export function serverSlotsLeft(planId, ownedCount) {
  return Math.max(0, limitsFor(planId).servers - ownedCount);
}

export function planBadgeHTML(planId, { small = false } = {}) {
  const plan = planOf(planId);
  if (plan.id === DEFAULT_PLAN) return '';
  return `<span class="plan-badge${small ? ' is-small' : ''}" style="--plan-color:${plan.badge.color}">${plan.badge.label}</span>`;
}

/** Which plan a person is on, looked up from what we know about them. */
export function planForUser(user) {
  return isPlanId(user?.plan) ? user.plan : DEFAULT_PLAN;
}
