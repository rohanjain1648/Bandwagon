import type { HackathonView, InviteView, JoinRequestView, TeamDetail } from '@bw/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ClaimPhase } from '../components/SeatSlots';
import { ApiError, api, errorMessage, newKey } from './api';
import { useAnnounce } from './announce';
import { keys } from './queries';

/** Invalidate everything a membership change can touch. */
function useRefreshAfterMembership(hid: string, slug: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.me });
    void qc.invalidateQueries({ queryKey: keys.hackathon(slug) });
    void qc.invalidateQueries({ queryKey: keys.myRequests(hid) });
    void qc.invalidateQueries({ queryKey: ['board'] });
    void qc.invalidateQueries({ queryKey: ['suggestions'] });
  };
}

const CONFLICT_TITLES: Record<string, string> = {
  TEAM_FULL: 'Someone got the last seat first',
  ALREADY_IN_TEAM: 'You’re already on a team',
  ROSTER_LOCKED: 'That roster is locked',
  TEAM_NOT_FOUND: 'That team no longer exists',
  FORMATION_CLOSED: 'Team formation has closed',
  APPROVAL_REQUIRED: 'This team approves members',
};

/**
 * Optimistic seat claim: the card shows a hatched "you" seat immediately. On a lost
 * race the seat bounces out and a toast says exactly what happened; on success the
 * real roster replaces it. The key is created once per press and reused on retry.
 */
export function useClaimSeat(hackathon: HackathonView) {
  const qc = useQueryClient();
  const { toast } = useAnnounce();
  const refresh = useRefreshAfterMembership(hackathon.id, hackathon.slug);
  const [claims, setClaims] = useState<Record<string, ClaimPhase>>({});

  const mutation = useMutation({
    mutationFn: ({ teamId }: { teamId: string; teamName: string }) => api.post<TeamDetail>(`/teams/${teamId}/join`, {}, newKey()),
    onMutate: ({ teamId }) => setClaims((c) => ({ ...c, [teamId]: 'claiming' })),
    onSuccess: (team) => {
      qc.setQueryData(keys.team(team.id), team);
      setClaims((c) => {
        const { [team.id]: _, ...rest } = c;
        return rest;
      });
      toast({ tone: 'success', title: `You’re on ${team.name}`, body: `Seat ${team.memberCount} of ${team.maxSize} is yours.` });
      refresh();
    },
    onError: (err, { teamId, teamName }) => {
      setClaims((c) => ({ ...c, [teamId]: 'bounced' }));
      setTimeout(
        () =>
          setClaims((c) => {
            const { [teamId]: _, ...rest } = c;
            return rest;
          }),
        700,
      );
      const code = err instanceof ApiError ? err.code : 'INTERNAL';
      toast({ tone: 'conflict', title: CONFLICT_TITLES[code] ?? `Couldn’t join ${teamName}`, body: errorMessage(err) });
      void qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  return { claims, claim: mutation.mutate, pending: mutation.isPending };
}

export function useRequestToJoin(hackathon: HackathonView) {
  const qc = useQueryClient();
  const { toast } = useAnnounce();
  return useMutation({
    mutationFn: ({ teamId, message }: { teamId: string; teamName: string; message: string }) =>
      api.post<{ id: string }>(`/teams/${teamId}/requests`, { message }, newKey()),
    onMutate: async ({ teamId, teamName }) => {
      const key = keys.myRequests(hackathon.id);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ items: JoinRequestView[] }>(key);
      const optimistic = { id: `optimistic-${teamId}`, teamId, teamName, teamNumber: 0, status: 'pending', message: '', createdAt: new Date().toISOString(), decidedAt: null } as unknown as JoinRequestView;
      qc.setQueryData(key, { items: [optimistic, ...(prev?.items ?? [])] });
      return { prev };
    },
    onError: (err, { teamName }, ctx) => {
      qc.setQueryData(keys.myRequests(hackathon.id), ctx?.prev);
      toast({ tone: 'conflict', title: `Request to ${teamName} not sent`, body: errorMessage(err) });
    },
    onSuccess: (_d, { teamName }) => toast({ tone: 'success', title: `Request sent to ${teamName}`, body: 'You’ll hear back here the moment the leader decides.' }),
    onSettled: (_d, _e, { teamId }) => {
      void qc.invalidateQueries({ queryKey: keys.myRequests(hackathon.id) });
      void qc.invalidateQueries({ queryKey: keys.team(teamId) });
    },
  });
}

export function useCancelRequest(hackathon: HackathonView) {
  const qc = useQueryClient();
  const { toast } = useAnnounce();
  return useMutation({
    mutationFn: ({ requestId }: { requestId: string }) => api.post(`/requests/${requestId}/cancel`, {}, newKey()),
    onMutate: async ({ requestId }) => {
      const key = keys.myRequests(hackathon.id);
      const prev = qc.getQueryData<{ items: JoinRequestView[] }>(key);
      qc.setQueryData(key, { items: (prev?.items ?? []).map((r) => (r.id === requestId ? { ...r, status: 'cancelled' as const } : r)) });
      return { prev };
    },
    onError: (err, _v, ctx) => {
      qc.setQueryData(keys.myRequests(hackathon.id), ctx?.prev);
      toast({ tone: 'conflict', title: 'Couldn’t cancel that request', body: errorMessage(err) });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.myRequests(hackathon.id) }),
  });
}

/** Accept / decline with the request removed from the inbox immediately; restored on conflict. */
export function useDecide(hackathon: HackathonView, teamId: string) {
  const qc = useQueryClient();
  const { toast } = useAnnounce();
  const refresh = useRefreshAfterMembership(hackathon.id, hackathon.slug);
  return useMutation({
    mutationFn: ({ requestId, decision }: { requestId: string; decision: 'accept' | 'decline'; name: string }) =>
      api.post<TeamDetail>(`/requests/${requestId}/${decision}`, {}, newKey()),
    onMutate: async ({ requestId }) => {
      await qc.cancelQueries({ queryKey: keys.team(teamId) });
      const prev = qc.getQueryData<TeamDetail>(keys.team(teamId));
      if (prev) qc.setQueryData(keys.team(teamId), { ...prev, requests: prev.requests.filter((r) => r.id !== requestId) });
      return { prev };
    },
    onError: (err, { name, decision }, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.team(teamId), ctx.prev);
      const code = err instanceof ApiError ? err.code : '';
      const title =
        code === 'TEAM_FULL' ? 'Your team is already full' : code === 'ALREADY_IN_TEAM' ? `${name} joined another team a moment ago` : `Couldn’t ${decision} ${name}`;
      toast({ tone: 'conflict', title, body: errorMessage(err) });
      void qc.invalidateQueries({ queryKey: keys.team(teamId) });
    },
    onSuccess: (team, { name, decision }) => {
      qc.setQueryData(keys.team(teamId), team);
      toast({ tone: decision === 'accept' ? 'success' : 'info', title: decision === 'accept' ? `${name} is on the team` : `Declined ${name}` });
      refresh();
    },
  });
}

export function useTeamCommand(hackathon: HackathonView, teamId: string) {
  const qc = useQueryClient();
  const { toast } = useAnnounce();
  const refresh = useRefreshAfterMembership(hackathon.id, hackathon.slug);
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown; success: string }) => api.post<TeamDetail>(`/teams/${teamId}${path}`, body ?? {}, newKey()),
    onSuccess: (team, { success }) => {
      qc.setQueryData(keys.team(teamId), team);
      toast({ tone: 'success', title: success });
      refresh();
    },
    onError: (err) => {
      toast({ tone: 'conflict', title: 'That didn’t go through', body: errorMessage(err) });
      void qc.invalidateQueries({ queryKey: keys.team(teamId) });
    },
  });
}

export function useNewInvite(teamId: string) {
  const qc = useQueryClient();
  const { toast } = useAnnounce();
  return useMutation({
    mutationFn: (body: { ttlHours: number; maxUses: number | null }) => api.post<InviteView>(`/teams/${teamId}/invites`, body, newKey()),
    onSuccess: (invite) => {
      const prev = qc.getQueryData<TeamDetail>(keys.team(teamId));
      if (prev) qc.setQueryData(keys.team(teamId), { ...prev, invite });
      toast({ tone: 'success', title: 'New invite code ready', body: 'The old code stopped working.' });
    },
    onError: (err) => toast({ tone: 'conflict', title: 'Couldn’t make a new code', body: errorMessage(err) }),
  });
}

export function useLeave(hackathon: HackathonView, teamId: string) {
  const { toast } = useAnnounce();
  const refresh = useRefreshAfterMembership(hackathon.id, hackathon.slug);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ teamDeleted: boolean; newLeaderId: string | null }>(`/teams/${teamId}/leave`, {}, newKey()),
    onSuccess: (r) => {
      qc.removeQueries({ queryKey: keys.team(teamId) });
      toast({ tone: 'info', title: r.teamDeleted ? 'You left, and the team was disbanded' : 'You left the team', body: r.teamDeleted ? 'You were the last member.' : undefined });
      refresh();
    },
    onError: (err) => toast({ tone: 'conflict', title: 'Couldn’t leave the team', body: errorMessage(err) }),
  });
}
