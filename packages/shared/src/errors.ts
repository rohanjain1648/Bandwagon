export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_LEADER: 403,
  VALIDATION: 400,
  NOT_FOUND: 404,
  TEAM_NOT_FOUND: 404,
  NOT_A_MEMBER: 404,
  NOT_REGISTERED: 409,
  INVALID_CODE: 404,
  CODE_EXPIRED: 410,
  TEAM_FULL: 409,
  ROSTER_LOCKED: 409,
  APPROVAL_REQUIRED: 409,
  ALREADY_IN_TEAM: 409,
  NAME_TAKEN: 409,
  EMAIL_TAKEN: 409,
  ALREADY_REQUESTED: 409,
  TOO_MANY_REQUESTS: 409,
  REQUEST_NOT_PENDING: 409,
  BELOW_MINIMUM: 409,
  CANNOT_REMOVE_SELF: 409,
  FORMATION_CLOSED: 409,
  VERSION_CONFLICT: 412,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** Default user-facing copy. Says what happened and what to do next. */
export const ERROR_COPY: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Please sign in to continue.',
  INVALID_CREDENTIALS: 'That email and password don’t match. Check both and try again.',
  FORBIDDEN: 'You don’t have access to that.',
  NOT_LEADER: 'Only the team leader can do that.',
  VALIDATION: 'Some fields need fixing.',
  NOT_FOUND: 'We couldn’t find that.',
  TEAM_NOT_FOUND: 'That team no longer exists. Its last member may have left.',
  NOT_A_MEMBER: 'You’re not on that team.',
  NOT_REGISTERED: 'Register for this hackathon first.',
  INVALID_CODE: 'That invite code doesn’t match any team. Check it with your leader.',
  CODE_EXPIRED: 'That invite code has expired or was replaced. Ask the leader for a new one.',
  TEAM_FULL: 'That was the last seat, and someone got it a moment before you.',
  ROSTER_LOCKED: 'This team has locked its roster and isn’t taking new members.',
  APPROVAL_REQUIRED: 'This team approves members. Send a join request instead.',
  ALREADY_IN_TEAM: 'You’re already on a team in this hackathon. Leave it first to join another.',
  NAME_TAKEN: 'Another team already uses that name. Try a different one.',
  EMAIL_TAKEN: 'An account with that email already exists. Sign in instead.',
  ALREADY_REQUESTED: 'You already have a pending request to this team.',
  TOO_MANY_REQUESTS: 'You have 5 pending requests. Cancel one before sending another.',
  REQUEST_NOT_PENDING: 'That request was already answered or cancelled.',
  BELOW_MINIMUM: 'The team needs to reach the minimum size before the roster can be locked.',
  CANNOT_REMOVE_SELF: 'Use “Leave team” to remove yourself.',
  FORMATION_CLOSED: 'Team formation for this hackathon has closed.',
  VERSION_CONFLICT: 'The team changed while you were editing. Review the latest version and try again.',
  IDEMPOTENCY_KEY_REUSED: 'This request key was already used for a different request.',
  RATE_LIMITED: 'Too many attempts. Wait a little and try again.',
  INTERNAL: 'Something went wrong on our side. Try again in a moment.',
};

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}
