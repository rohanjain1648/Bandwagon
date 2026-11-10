import type { Db } from '../db/pool';

export type AuditAction =
  | 'team.created'
  | 'team.updated'
  | 'team.deleted'
  | 'member.joined'
  | 'member.left'
  | 'member.removed'
  | 'leader.changed'
  | 'roster.locked'
  | 'roster.unlocked'
  | 'request.created'
  | 'request.accepted'
  | 'request.declined'
  | 'request.cancelled'
  | 'invite.created'
  | 'invite.revoked';

export interface AuditInput {
  hackathonId: string;
  teamId?: string | null;
  teamName?: string | null;
  actorId?: string | null;
  action: AuditAction;
  subjectId?: string | null;
  details?: Record<string, unknown>;
  requestId?: string | null;
}

/** Written inside the command's transaction: no change without its record, no record without its change. */
export async function audit(db: Db, e: AuditInput): Promise<void> {
  await db`
    INSERT INTO audit_log (hackathon_id, team_id, team_name, actor_id, action, subject_id, details, request_id)
    VALUES (${e.hackathonId}, ${e.teamId ?? null}, ${e.teamName ?? null}, ${e.actorId ?? null}, ${e.action},
            ${e.subjectId ?? null}, ${db.json((e.details ?? {}) as never)}, ${e.requestId ?? null})`;
}
