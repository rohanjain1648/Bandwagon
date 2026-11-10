import type { BoardFrame, PersonalEvent, TeamSnapshot } from '@bw/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useAnnounce } from './announce';
import { applyBoardFrame, keys } from './queries';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

const PERSONAL_COPY: Record<PersonalEvent['kind'], (e: PersonalEvent) => { title: string; body?: string; tone: 'info' | 'success' | 'conflict' }> = {
  'request.created': (e) => ({ title: `${e.actorName ?? 'Someone'} wants to join ${e.teamName}`, body: 'Review it in your team’s inbox.', tone: 'info' }),
  'request.decided': (e) =>
    e.status === 'accepted'
      ? { title: `You’re on ${e.teamName}`, body: 'Your request was accepted.', tone: 'success' }
      : { title: `${e.teamName} declined your request`, body: 'Plenty of other teams have open seats.', tone: 'info' },
  'request.cancelled': (e) => ({ title: `A request to ${e.teamName} was withdrawn`, tone: 'info' }),
  'member.removed': (e) => ({ title: `You were removed from ${e.teamName}`, body: 'The leader made this change. It’s in the team’s activity log.', tone: 'conflict' }),
  'member.joined': (e) => ({ title: `${e.subjectName ?? 'Someone'} joined ${e.teamName}`, tone: 'success' }),
  'member.left': (e) => ({ title: `${e.subjectName ?? 'A member'} left ${e.teamName}`, tone: 'info' }),
  'leader.changed': (e) => ({ title: `You now lead ${e.teamName}`, body: 'You can accept requests and manage the invite code.', tone: 'success' }),
  'team.deleted': (e) => ({ title: `${e.teamName} no longer exists`, body: 'Its last member left, so your pending request was closed.', tone: 'info' }),
};

/**
 * One EventSource per hackathon. Board frames patch the query cache in place
 * (newer versions win); personal frames become toasts. After any reconnect we
 * resync everything: simpler than replaying gaps, and never wrong.
 */
export function useLiveEvents(hackathonId: string | undefined, onNewTeams?: (teams: TeamSnapshot[]) => void) {
  const qc = useQueryClient();
  const { say, toast } = useAnnounce();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const onNewRef = useRef(onNewTeams);
  onNewRef.current = onNewTeams;

  useEffect(() => {
    if (!hackathonId) return;
    const es = new EventSource(`/api/hackathons/${hackathonId}/events`, { withCredentials: true });
    let dropped = false;

    es.addEventListener('hello', () => {
      setStatus('live');
      if (dropped) {
        dropped = false;
        void qc.invalidateQueries();
        say('Reconnected. The board is up to date.');
      }
    });
    es.addEventListener('board', (ev) => {
      const frame = JSON.parse((ev as MessageEvent).data) as BoardFrame;
      const { newTeams } = applyBoardFrame(qc, hackathonId, frame);
      if (newTeams.length) onNewRef.current?.(newTeams);
      const filled = frame.teams.filter((t) => t.memberCount >= t.maxSize);
      if (filled.length === 1) say(`${filled[0]!.name} just filled its last seat.`);
      else if (filled.length > 1) say(`${filled.length} teams just filled up.`);
      void qc.invalidateQueries({ queryKey: keys.hackathon(hackathonId) });
    });
    es.addEventListener('personal', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as PersonalEvent;
      toast(PERSONAL_COPY[e.kind](e));
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.team(e.teamId) });
      void qc.invalidateQueries({ queryKey: keys.myRequests(hackathonId) });
      void qc.invalidateQueries({ queryKey: keys.hackathon(hackathonId) });
    });
    es.addEventListener('resync', () => void qc.invalidateQueries());
    es.onerror = () => {
      dropped = true;
      setStatus('reconnecting');
    };
    return () => es.close();
  }, [hackathonId, qc, say, toast]);

  return status;
}
