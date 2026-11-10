-- Bandwagon schema. The database is the referee: the rules that matter under
-- contention are constraints and triggers here, not conventions in app code.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── users ──────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  password_hash      text NOT NULL,
  display_name       text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
  bio                text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 280),
  skills             text[] NOT NULL DEFAULT '{}' CHECK (cardinality(skills) <= 12),
  timezone           text NOT NULL,
  utc_offset_minutes smallint NOT NULL CHECK (utc_offset_minutes BETWEEN -720 AND 840),
  work_start_hour    smallint NOT NULL DEFAULT 9  CHECK (work_start_hour BETWEEN 0 AND 23),
  work_end_hour      smallint NOT NULL DEFAULT 22 CHECK (work_end_hour BETWEEN 0 AND 23),
  role               text NOT NULL DEFAULT 'participant' CHECK (role IN ('participant', 'organizer')),
  is_demo            boolean NOT NULL DEFAULT false,
  demo_persona       text NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_skills_gin ON users USING gin (skills);
CREATE INDEX users_demo_persona ON users (demo_persona) WHERE demo_persona IS NOT NULL;

-- ── hackathons ─────────────────────────────────────────────────────────────
CREATE TABLE hackathons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  name                text NOT NULL,
  min_team_size       smallint NOT NULL CHECK (min_team_size >= 1),
  max_team_size       smallint NOT NULL,
  formation_closes_at timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hackathon_size_rule CHECK (max_team_size >= min_team_size AND max_team_size <= 10)
);

-- ── teams ──────────────────────────────────────────────────────────────────
CREATE SEQUENCE team_number_seq START 1;

CREATE TABLE teams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id  uuid NOT NULL REFERENCES hackathons (id) ON DELETE CASCADE,
  number        integer NOT NULL DEFAULT nextval('team_number_seq'),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  description   text NOT NULL DEFAULT '' CHECK (char_length(description) <= 280),
  looking_for   text[] NOT NULL DEFAULT '{}' CHECK (cardinality(looking_for) <= 8),
  skills        text[] NOT NULL DEFAULT '{}',
  join_policy   text NOT NULL DEFAULT 'approval' CHECK (join_policy IN ('open', 'approval')),
  leader_id     uuid NOT NULL REFERENCES users (id),
  member_count  smallint NOT NULL DEFAULT 0,
  min_size      smallint NOT NULL,
  max_size      smallint NOT NULL,
  roster_locked boolean NOT NULL DEFAULT false,
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_id_hackathon_unique UNIQUE (id, hackathon_id),
  -- Capacity is a constraint: no code path, buggy or not, can overfill a team.
  CONSTRAINT seats_within_bounds CHECK (member_count >= 0 AND member_count <= max_size),
  CONSTRAINT team_size_rule CHECK (min_size >= 1 AND max_size >= min_size)
);
CREATE UNIQUE INDEX teams_name_unique ON teams (hackathon_id, lower(name));
CREATE INDEX teams_board_newest  ON teams (hackathon_id, created_at DESC, id DESC);
CREATE INDEX teams_board_filling ON teams (hackathon_id, member_count DESC, created_at DESC, id DESC);
CREATE INDEX teams_skills_gin      ON teams USING gin (skills);
CREATE INDEX teams_looking_for_gin ON teams USING gin (looking_for);
CREATE INDEX teams_name_trgm       ON teams USING gin (name gin_trgm_ops);
CREATE INDEX teams_leader          ON teams (leader_id);

-- ── participants: registration AND membership in one row ───────────────────
-- team_id is a single nullable column, so "one team per person per hackathon"
-- is not a rule we check: two teams for one person cannot be represented.
CREATE TABLE participants (
  hackathon_id     uuid NOT NULL REFERENCES hackathons (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  team_id          uuid NULL,
  team_joined_at   timestamptz NULL,
  looking_for_team boolean NOT NULL DEFAULT true,
  registered_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hackathon_id, user_id),
  CONSTRAINT participants_team_user_unique UNIQUE (team_id, user_id),
  -- membership can only point at a team of the same hackathon
  CONSTRAINT participants_team_fk FOREIGN KEY (team_id, hackathon_id)
    REFERENCES teams (id, hackathon_id) ON DELETE SET NULL (team_id)
);
CREATE INDEX participants_team ON participants (team_id, team_joined_at) WHERE team_id IS NOT NULL;
CREATE INDEX participants_solo ON participants (hackathon_id, registered_at DESC, user_id DESC)
  WHERE team_id IS NULL AND looking_for_team;
CREATE INDEX participants_user ON participants (user_id);

-- The leader must be a member of their own team. Deferred so a transaction can
-- create a team and seat its leader, or hand leadership over, before the check.
ALTER TABLE teams ADD CONSTRAINT leader_is_member
  FOREIGN KEY (id, leader_id) REFERENCES participants (team_id, user_id)
  DEFERRABLE INITIALLY DEFERRED;

-- ── invite codes ───────────────────────────────────────────────────────────
CREATE TABLE invite_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, not CASCADE: a code for a deleted team should say "team gone", not "invalid code"
  team_id    uuid NULL REFERENCES teams (id) ON DELETE SET NULL,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  max_uses   smallint NULL CHECK (max_uses IS NULL OR max_uses > 0),
  uses       smallint NOT NULL DEFAULT 0,
  revoked_at timestamptz NULL,
  CONSTRAINT invite_uses_within_limit CHECK (max_uses IS NULL OR uses <= max_uses)
);
CREATE INDEX invite_codes_team_active ON invite_codes (team_id) WHERE revoked_at IS NULL;

-- ── join requests ──────────────────────────────────────────────────────────
CREATE TABLE join_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL,
  hackathon_id uuid NOT NULL,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  message      text NOT NULL DEFAULT '' CHECK (char_length(message) <= 280),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz NULL,
  decided_by   uuid NULL REFERENCES users (id),
  CONSTRAINT join_requests_team_fk FOREIGN KEY (team_id, hackathon_id)
    REFERENCES teams (id, hackathon_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX join_requests_one_pending ON join_requests (team_id, user_id) WHERE status = 'pending';
CREATE INDEX join_requests_user_pending ON join_requests (hackathon_id, user_id) WHERE status = 'pending';
CREATE INDEX join_requests_team_pending ON join_requests (team_id, created_at) WHERE status = 'pending';
CREATE INDEX join_requests_user ON join_requests (user_id, created_at DESC);

-- ── audit log (append-only) ────────────────────────────────────────────────
CREATE TABLE audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hackathon_id uuid NOT NULL,
  team_id      uuid NULL,        -- deliberately no FK: history outlives the team
  team_name    text NULL,
  actor_id     uuid NULL,
  action       text NOT NULL,
  subject_id   uuid NULL,
  details      jsonb NOT NULL DEFAULT '{}',
  request_id   text NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_team      ON audit_log (team_id, id DESC);
CREATE INDEX audit_hackathon ON audit_log (hackathon_id, id DESC);

CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_update   BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- ── idempotency & rate limiting ────────────────────────────────────────────
CREATE TABLE idempotency_keys (
  user_id      uuid NOT NULL,
  key          text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 100),
  request_hash text NOT NULL,
  status_code  smallint NULL,
  response     json NULL,          -- json (not jsonb): a replay must be the original bytes, key order included
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_created ON idempotency_keys (created_at);

CREATE TABLE rate_limits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX rate_limits_window ON rate_limits (window_start);

-- ── triggers that keep derived team state exact ────────────────────────────
CREATE FUNCTION recompute_team_skills(p_team uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT s ORDER BY s), '{}')
  FROM participants p
  JOIN users u ON u.id = p.user_id
  CROSS JOIN LATERAL unnest(u.skills) AS s
  WHERE p.team_id = p_team
$$;

-- member_count moves in the same statement as the membership change, so the
-- seats_within_bounds CHECK fires on the exact write that would overfill a team.
CREATE FUNCTION participants_team_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_team uuid := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.team_id END;
  new_team uuid := CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN NEW.team_id END;
BEGIN
  IF old_team IS NOT DISTINCT FROM new_team THEN
    RETURN NULL;
  END IF;
  IF old_team IS NOT NULL THEN
    UPDATE teams
       SET member_count = member_count - 1,
           skills = recompute_team_skills(old_team),
           version = version + 1,
           updated_at = now()
     WHERE id = old_team;
  END IF;
  IF new_team IS NOT NULL THEN
    UPDATE teams
       SET member_count = member_count + 1,
           skills = recompute_team_skills(new_team),
           version = version + 1,
           updated_at = now()
     WHERE id = new_team;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER participants_team_change
  AFTER INSERT OR UPDATE OF team_id OR DELETE ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_team_change();

CREATE FUNCTION users_skills_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.skills IS DISTINCT FROM NEW.skills THEN
    UPDATE teams t
       SET skills = recompute_team_skills(t.id), version = version + 1, updated_at = now()
     WHERE t.id IN (SELECT p.team_id FROM participants p WHERE p.user_id = NEW.id AND p.team_id IS NOT NULL);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER users_skills_change AFTER UPDATE OF skills ON users
  FOR EACH ROW EXECUTE FUNCTION users_skills_change();

-- ── invariant checker (tests, chaos run, organizer endpoint) ───────────────
CREATE FUNCTION bw_check_invariants() RETURNS TABLE (kind text, team_id uuid, detail text)
LANGUAGE sql STABLE AS $$
  SELECT 'member_count_mismatch', t.id, format('member_count=%s actual=%s', t.member_count, COALESCE(c.n, 0))
    FROM teams t
    LEFT JOIN (SELECT p.team_id AS tid, count(*) AS n FROM participants p WHERE p.team_id IS NOT NULL GROUP BY p.team_id) c
      ON c.tid = t.id
   WHERE t.member_count <> COALESCE(c.n, 0)
  UNION ALL
  SELECT 'over_capacity', t.id, format('%s/%s', t.member_count, t.max_size)
    FROM teams t WHERE t.member_count > t.max_size
  UNION ALL
  SELECT 'empty_team', t.id, 'a team with no members must not exist'
    FROM teams t WHERE NOT EXISTS (SELECT 1 FROM participants p WHERE p.team_id = t.id)
  UNION ALL
  SELECT 'leader_not_member', t.id, t.leader_id::text
    FROM teams t WHERE NOT EXISTS (SELECT 1 FROM participants p WHERE p.team_id = t.id AND p.user_id = t.leader_id)
  UNION ALL
  SELECT 'locked_below_min', t.id, format('%s < %s', t.member_count, t.min_size)
    FROM teams t WHERE t.roster_locked AND t.member_count < t.min_size
  UNION ALL
  SELECT 'pending_request_from_member', r.team_id, r.user_id::text
    FROM join_requests r
    JOIN participants p ON p.hackathon_id = r.hackathon_id AND p.user_id = r.user_id
   WHERE r.status = 'pending' AND p.team_id IS NOT NULL
  UNION ALL
  SELECT 'invite_over_limit', i.team_id, i.id::text
    FROM invite_codes i WHERE i.max_uses IS NOT NULL AND i.uses > i.max_uses
$$;
