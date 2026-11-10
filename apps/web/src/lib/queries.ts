import type {
  BoardFrame,
  HackathonView,
  InvitePreview,
  JoinRequestView,
  MeView,
  Page,
  PersonSnapshot,
  PersonSuggestion,
  ScoringExplainer,
  TeamDetail,
  TeamSnapshot,
  TeamSuggestion,
  AuditEntryView,
} from '@bw/shared';
import { QueryClient, useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import { ApiError, api } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

export const keys = {
  me: ['me'] as const,
  hackathon: (ref: string) => ['hackathon', ref] as const,
  boardTeams: (hid: string, params: string) => ['board', 'teams', hid, params] as const,
  boardPeople: (hid: string, params: string) => ['board', 'people', hid, params] as const,
  team: (id: string) => ['team', id] as const,
  myRequests: (hid: string) => ['my-requests', hid] as const,
  suggestionsPeople: (hid: string) => ['suggestions', 'people', hid] as const,
  suggestionsTeams: (hid: string) => ['suggestions', 'teams', hid] as const,
  audit: (teamId: string) => ['audit', teamId] as const,
  invite: (code: string) => ['invite', code] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.get<MeView>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useHackathon(ref: string | undefined) {
  return useQuery({
    queryKey: keys.hackathon(ref ?? ''),
    queryFn: () => api.get<HackathonView>(`/hackathons/${ref}`),
    enabled: Boolean(ref),
    refetchInterval: 30_000,
  });
}

export function useBoardTeams(hid: string | undefined, params: URLSearchParams) {
  const qs = params.toString();
  return useInfiniteQuery({
    queryKey: keys.boardTeams(hid ?? '', qs),
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<TeamSnapshot>>(`/hackathons/${hid}/board/teams?${qs}${pageParam ? `&cursor=${pageParam}` : ''}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(hid),
  });
}

export function useBoardPeople(hid: string | undefined, params: URLSearchParams) {
  const qs = params.toString();
  return useInfiniteQuery({
    queryKey: keys.boardPeople(hid ?? '', qs),
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<PersonSnapshot>>(`/hackathons/${hid}/board/people?${qs}${pageParam ? `&cursor=${pageParam}` : ''}`, signal),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(hid),
  });
}

export function useTeam(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.team(id ?? ''),
    queryFn: () => api.get<TeamDetail>(`/teams/${id}`),
    enabled: Boolean(id),
  });
}

export function useMyRequests(hid: string | undefined) {
  return useQuery({
    queryKey: keys.myRequests(hid ?? ''),
    queryFn: () => api.get<{ items: JoinRequestView[] }>(`/hackathons/${hid}/me/requests`),
    enabled: Boolean(hid),
  });
}

export interface PeopleSuggestions {
  perspective: { kind: 'team' | 'solo'; teamId: string | null; have: string[]; want: string[]; missingRoles: string[] };
  scoring: ScoringExplainer;
  poolSize: number;
  items: PersonSuggestion[];
}

export function usePeopleSuggestions(hid: string | undefined, limit = 10) {
  return useQuery({
    queryKey: [...keys.suggestionsPeople(hid ?? ''), limit],
    queryFn: () => api.get<PeopleSuggestions>(`/hackathons/${hid}/suggestions/people?limit=${limit}`),
    enabled: Boolean(hid),
    staleTime: 60_000,
  });
}

export function useTeamSuggestions(hid: string | undefined, limit = 10, enabled = true) {
  return useQuery({
    queryKey: [...keys.suggestionsTeams(hid ?? ''), limit],
    queryFn: () => api.get<{ scoring: ScoringExplainer; items: TeamSuggestion[] }>(`/hackathons/${hid}/suggestions/teams?limit=${limit}`),
    enabled: Boolean(hid) && enabled,
    staleTime: 60_000,
  });
}

export function useAudit(teamId: string | undefined, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: keys.audit(teamId ?? ''),
    queryFn: ({ pageParam }) =>
      api.get<{ items: AuditEntryView[]; nextCursor: string | null }>(`/teams/${teamId}/audit?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(teamId) && enabled,
  });
}

export function useInvitePreview(code: string | undefined) {
  return useQuery({
    queryKey: keys.invite(code ?? ''),
    queryFn: () => api.get<InvitePreview>(`/invites/${encodeURIComponent(code ?? '')}`),
    enabled: Boolean(code),
    retry: false,
  });
}

// ── live frames → cache ────────────────────────────────────────────────────

type TeamPages = InfiniteData<Page<TeamSnapshot>, string>;
type PeoplePages = InfiniteData<Page<PersonSnapshot>, string>;

/** Merge a board frame into every cached board page: newer versions win, nothing jumps. */
export function applyBoardFrame(qc: QueryClient, hid: string, frame: BoardFrame): { newTeams: TeamSnapshot[] } {
  const byId = new Map(frame.teams.map((t) => [t.id, t]));
  const removed = new Set(frame.removed);
  const seen = new Set<string>();
  qc.setQueriesData<TeamPages>({ queryKey: ['board', 'teams', hid] }, (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((item) => {
          seen.add(item.id);
          if (removed.has(item.id)) return { ...item, memberCount: 0, members: [], removed: true } as TeamSnapshot & { removed: true };
          const next = byId.get(item.id);
          return next && next.version > item.version ? next : item;
        }),
      })),
    };
  });
  const peopleChanged = new Map(frame.people.map((p) => [p.id, p]));
  const peopleGone = new Set(frame.peopleRemoved);
  qc.setQueriesData<PeoplePages>({ queryKey: ['board', 'people', hid] }, (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((p) => (peopleGone.has(p.id) ? { ...p, gone: true } : (peopleChanged.get(p.id) ?? p))),
      })),
    };
  });
  for (const t of frame.teams) {
    if (qc.getQueryData(keys.team(t.id))) void qc.invalidateQueries({ queryKey: keys.team(t.id) });
  }
  for (const id of frame.removed) {
    if (qc.getQueryData(keys.team(id))) void qc.invalidateQueries({ queryKey: keys.team(id) });
  }
  return { newTeams: frame.teams.filter((t) => !seen.has(t.id) && t.memberCount < t.maxSize && !t.rosterLocked) };
}
