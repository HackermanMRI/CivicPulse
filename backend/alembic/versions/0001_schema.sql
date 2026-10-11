-- CivicPulse schema, frozen for migration 0001 (spec §7).
-- Generated once with pg_dump --schema-only from the SQLAlchemy models, so this migration never
-- changes when the models change. Every later change needs its own migration (0002, 0003, ...).

CREATE TYPE public.abuse_state AS ENUM (
    'open',
    'reviewed'
);

CREATE TYPE public.address_kind AS ENUM (
    'home',
    'work',
    'other'
);

CREATE TYPE public.alert_test AS ENUM (
    'c_test',
    'negative_binomial'
);

CREATE TYPE public.annotator AS ENUM (
    'member_b',
    'independent'
);

CREATE TYPE public.availability AS ENUM (
    'available',
    'partial',
    'unavailable'
);

CREATE TYPE public.collusion_kind AS ENUM (
    'pair_agreement',
    'device_violation'
);

CREATE TYPE public.collusion_outcome AS ENUM (
    'collusion_confirmed',
    'false_alarm'
);

CREATE TYPE public.collusion_state AS ENUM (
    'open',
    'solved'
);

CREATE TYPE public.commodity_unit AS ENUM (
    'kg',
    'litre',
    'piece',
    'hali',
    'dozen'
);

CREATE TYPE public.component AS ENUM (
    'text',
    'image',
    'gps',
    'metadata',
    'reputation',
    'community',
    'history'
);

CREATE TYPE public.consent_purpose AS ENUM (
    'location',
    'camera',
    'research_use'
);

CREATE TYPE public.evidence_kind AS ENUM (
    'report_photo',
    'verification_photo',
    'product_photo',
    'receipt'
);

CREATE TYPE public.issue_present AS ENUM (
    'yes',
    'no',
    'cant_tell'
);

CREATE TYPE public.judging_status AS ENUM (
    'strongly_supported',
    'supported',
    'uncertain',
    'not_supported'
);

CREATE TYPE public.market_source AS ENUM (
    'osm',
    'field'
);

CREATE TYPE public.notification_kind AS ENUM (
    'new_report_in_ward',
    'own_report_status',
    'pinned_report_status',
    'emerging_issue',
    'price_alert'
);

CREATE TYPE public.otp_purpose AS ENUM (
    'signup',
    'reset',
    'admin'
);

CREATE TYPE public.reference_source AS ENUM (
    'TCB',
    'DAM',
    'field'
);

CREATE TYPE public.rep_kind AS ENUM (
    'report_positive',
    'report_negative',
    'duplicate',
    'vote_agree',
    'vote_disagree'
);

CREATE TYPE public.report_status AS ENUM (
    'pending',
    'strongly_supported',
    'supported',
    'uncertain',
    'not_supported'
);

CREATE TYPE public.report_type AS ENUM (
    'civic',
    'price'
);

CREATE TYPE public.run_trigger AS ENUM (
    'submit',
    'vote',
    'upgrade',
    'corroboration',
    'admin_restore',
    'recompute'
);

CREATE TYPE public.score_view AS ENUM (
    'displayed',
    'judging'
);

CREATE TYPE public.token_purpose AS ENUM (
    'report',
    'verification',
    'price_photo'
);

CREATE TYPE public.user_role AS ENUM (
    'citizen',
    'admin'
);

CREATE TYPE public.user_state AS ENUM (
    'active',
    'flagged',
    'suspended',
    'deleted'
);

CREATE TYPE public.verified_status AS ENUM (
    'Verified',
    'Insufficient Evidence'
);

CREATE TYPE public.visibility AS ENUM (
    'visible',
    'auto_hidden',
    'admin_hidden'
);

CREATE TYPE public.vote_decision AS ENUM (
    'confirm',
    'disagree',
    'fixed_now'
);

CREATE TYPE public.vote_mode AS ENUM (
    'on_spot',
    'same_ward',
    'far_away'
);

CREATE TYPE public.ward_method AS ENUM (
    'polygon',
    'radius',
    'none'
);

CREATE TYPE public.weight_profile AS ENUM (
    'A',
    'B'
);

CREATE TABLE public.abuse_reports (
    id uuid NOT NULL,
    report_id uuid NOT NULL,
    reporter_id uuid,
    reason character varying(500) NOT NULL,
    state public.abuse_state NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.alerts (
    id uuid NOT NULL,
    kind text NOT NULL,
    ward_id integer NOT NULL,
    category_id integer NOT NULL,
    test_date date NOT NULL,
    observed integer NOT NULL,
    baseline_n integer NOT NULL,
    baseline_days integer NOT NULL,
    p_value double precision NOT NULL,
    test public.alert_test NOT NULL,
    mean_credibility double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    actor_id uuid,
    action character varying(60) NOT NULL,
    entity character varying(40) NOT NULL,
    entity_id character varying(64),
    before jsonb,
    after jsonb,
    reason text,
    ip_hash character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;

CREATE TABLE public.capture_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    purpose public.token_purpose NOT NULL,
    report_id uuid,
    captured_at timestamp with time zone NOT NULL,
    renewed_from_id uuid,
    retake_index smallint NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);

CREATE TABLE public.categories (
    id integer NOT NULL,
    code character varying(40) NOT NULL,
    name_en text NOT NULL,
    name_bn text NOT NULL,
    impact numeric(3,2) NOT NULL,
    extent numeric(3,2) NOT NULL,
    urgency numeric(3,2) NOT NULL,
    text_prototypes text[] NOT NULL,
    clip_prompts text[] NOT NULL,
    active boolean NOT NULL,
    CONSTRAINT ck_categories_extent CHECK (((extent >= (0)::numeric) AND (extent <= (1)::numeric))),
    CONSTRAINT ck_categories_impact CHECK (((impact >= (0)::numeric) AND (impact <= (1)::numeric))),
    CONSTRAINT ck_categories_urgency CHECK (((urgency >= (0)::numeric) AND (urgency <= (1)::numeric)))
);

CREATE SEQUENCE public.categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;

CREATE TABLE public.collusion_alerts (
    id uuid NOT NULL,
    kind public.collusion_kind NOT NULL,
    user_ids uuid[] NOT NULL,
    report_ids uuid[] NOT NULL,
    signals jsonb NOT NULL,
    status public.collusion_state NOT NULL,
    outcome public.collusion_outcome,
    note text,
    solved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    solved_at timestamp with time zone,
    CONSTRAINT ck_alert_solved_needs_note CHECK (((status = 'open'::public.collusion_state) OR ((outcome IS NOT NULL) AND (note IS NOT NULL) AND (length(note) > 0))))
);

CREATE TABLE public.commodities (
    id integer NOT NULL,
    name_en text NOT NULL,
    name_bn text NOT NULL,
    variant text NOT NULL,
    unit public.commodity_unit NOT NULL,
    active boolean NOT NULL,
    is_demo boolean DEFAULT false NOT NULL
);

CREATE SEQUENCE public.commodities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.commodities_id_seq OWNED BY public.commodities.id;

CREATE TABLE public.consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    purpose public.consent_purpose NOT NULL,
    granted boolean NOT NULL,
    version character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.devices (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    device_hash character varying(64) NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone
);

CREATE TABLE public.events (
    id uuid NOT NULL,
    category_id integer NOT NULL,
    centroid public.geography(Point,4326) NOT NULL,
    first_seen timestamp with time zone NOT NULL,
    last_seen timestamp with time zone NOT NULL,
    report_count integer NOT NULL,
    resolved_at timestamp with time zone
);

CREATE TABLE public.evidence (
    id uuid NOT NULL,
    report_id uuid,
    vote_id uuid,
    kind public.evidence_kind NOT NULL,
    file_path text NOT NULL,
    mime character varying(40) NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    bytes integer NOT NULL,
    sha256 character varying(64) NOT NULL,
    phash bit(64) NOT NULL,
    capture_method character varying(20) NOT NULL,
    token_id uuid,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_evidence_owner CHECK (((report_id IS NOT NULL) <> (vote_id IS NOT NULL)))
);

CREATE TABLE public.hotspots (
    id uuid NOT NULL,
    category_id integer NOT NULL,
    centroid public.geography(Point,4326) NOT NULL,
    hull public.geometry(Polygon,4326),
    score double precision NOT NULL,
    s_severity double precision NOT NULL,
    v_volume double precision NOT NULL,
    c_compact double precision NOT NULL,
    t_trust double precision NOT NULL,
    n_reports integer NOT NULL,
    n_users integer NOT NULL,
    report_ids uuid[] NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    eps_m double precision NOT NULL,
    min_samples integer NOT NULL,
    config_hash text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.label_final (
    report_id uuid NOT NULL,
    label public.judging_status NOT NULL,
    issue_present public.issue_present NOT NULL,
    adjudicated boolean NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.label_import_batches (
    id uuid NOT NULL,
    annotator public.annotator NOT NULL,
    file_sha256 character varying(64) NOT NULL,
    row_count integer NOT NULL,
    imported_by text NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.labels (
    id uuid NOT NULL,
    report_id uuid NOT NULL,
    annotator public.annotator NOT NULL,
    batch_id uuid NOT NULL,
    label public.judging_status NOT NULL,
    issue_present public.issue_present NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.live_days (
    date date NOT NULL,
    live boolean NOT NULL
);

CREATE TABLE public.markets (
    id integer NOT NULL,
    name_en text NOT NULL,
    name_bn text NOT NULL,
    ward_id integer,
    location public.geography(Point,4326) NOT NULL,
    radius_m integer NOT NULL,
    source public.market_source NOT NULL,
    verified boolean NOT NULL,
    is_demo boolean DEFAULT false NOT NULL
);

CREATE SEQUENCE public.markets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.markets_id_seq OWNED BY public.markets.id;

CREATE TABLE public.notifications (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind public.notification_kind NOT NULL,
    report_id uuid,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone
);

CREATE TABLE public.otp_codes (
    id uuid NOT NULL,
    phone character varying(20) NOT NULL,
    purpose public.otp_purpose NOT NULL,
    code_hash character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.price_alert_watch (
    user_id uuid NOT NULL,
    commodity_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.price_details (
    report_id uuid NOT NULL,
    commodity_id integer NOT NULL,
    market_id integer NOT NULL,
    price_bdt numeric(10,2) NOT NULL,
    unit_qty numeric(8,3) NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    observed_date date NOT NULL,
    CONSTRAINT ck_price_positive CHECK ((price_bdt > (0)::numeric))
);

CREATE TABLE public.reference_prices (
    id uuid NOT NULL,
    source public.reference_source NOT NULL,
    commodity_id integer NOT NULL,
    market_id integer,
    date date NOT NULL,
    min_bdt numeric(10,2) NOT NULL,
    max_bdt numeric(10,2) NOT NULL
);

CREATE TABLE public.refresh_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    family_id uuid NOT NULL,
    token_hash character varying(64) NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by uuid
);

CREATE TABLE public.reports (
    id uuid NOT NULL,
    user_id uuid,
    report_type public.report_type NOT NULL,
    category_id integer,
    description text,
    location public.geography(Point,4326),
    gps_accuracy_m double precision,
    ward_id integer,
    ward_method public.ward_method NOT NULL,
    event_id uuid,
    capture_token_id uuid,
    device_id uuid,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    alpha double precision NOT NULL,
    beta double precision NOT NULL,
    credibility double precision NOT NULL,
    uncertainty double precision NOT NULL,
    conflict double precision NOT NULL,
    status public.report_status NOT NULL,
    judging_status public.judging_status,
    flags text[] DEFAULT '{}'::text[] NOT NULL,
    components_used smallint NOT NULL,
    visibility public.visibility NOT NULL,
    visibility_reason text,
    visibility_changed_at timestamp with time zone,
    is_seed boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_reports_beta_prior CHECK (((alpha >= (1)::double precision) AND (beta >= (1)::double precision))),
    CONSTRAINT ck_reports_civic_fields CHECK (((report_type <> 'civic'::public.report_type) OR ((category_id IS NOT NULL) AND (location IS NOT NULL)))),
    CONSTRAINT ck_reports_description_len CHECK (((description IS NULL) OR (char_length(description) <= 2000)))
);

CREATE TABLE public.reputation_events (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    kind public.rep_kind NOT NULL,
    d_alpha double precision NOT NULL,
    d_beta double precision NOT NULL,
    report_id uuid NOT NULL,
    vote_id uuid,
    occurred_at timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    superseded_at timestamp with time zone
);

CREATE SEQUENCE public.reputation_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.reputation_events_id_seq OWNED BY public.reputation_events.id;

CREATE TABLE public.saved_posts (
    user_id uuid NOT NULL,
    report_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.scoring_runs (
    id bigint NOT NULL,
    report_id uuid NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    trigger public.run_trigger NOT NULL,
    weight_profile public.weight_profile NOT NULL,
    alpha double precision NOT NULL,
    beta double precision NOT NULL,
    credibility double precision NOT NULL,
    uncertainty double precision NOT NULL,
    conflict double precision NOT NULL,
    status public.judging_status NOT NULL,
    judging_status public.judging_status NOT NULL,
    flags text[] DEFAULT '{}'::text[] NOT NULL,
    gates jsonb NOT NULL,
    config_hash text NOT NULL,
    scoring_version text NOT NULL
);

CREATE SEQUENCE public.scoring_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.scoring_runs_id_seq OWNED BY public.scoring_runs.id;

CREATE TABLE public.trust_scores (
    run_id bigint NOT NULL,
    view public.score_view NOT NULL,
    component public.component NOT NULL,
    availability public.availability NOT NULL,
    score double precision,
    weight double precision NOT NULL,
    pos_ev double precision NOT NULL,
    neg_ev double precision NOT NULL,
    explanation text NOT NULL,
    model_version text
);

CREATE TABLE public.user_addresses (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    ward_id integer,
    kind public.address_kind NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
    id uuid NOT NULL,
    display_name character varying(80),
    phone character varying(20),
    phone_verified boolean NOT NULL,
    email character varying(254),
    pass_hash text,
    role public.user_role NOT NULL,
    state public.user_state NOT NULL,
    preferred_module character varying(20),
    is_seed boolean DEFAULT false NOT NULL,
    suspended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_users_module CHECK (((preferred_module IS NULL) OR ((preferred_module)::text = ANY ((ARRAY['green_guard'::character varying, 'price_patrol'::character varying])::text[]))))
);

CREATE TABLE public.verified_prices (
    id uuid NOT NULL,
    commodity_id integer NOT NULL,
    market_id integer NOT NULL,
    date date NOT NULL,
    verified_price numeric(10,2),
    report_count integer NOT NULL,
    status public.verified_status NOT NULL,
    report_ids uuid[] NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.voter_pairs (
    user_a uuid NOT NULL,
    user_b uuid NOT NULL,
    co_votes integer NOT NULL,
    disputed_co_votes integer NOT NULL,
    disputed_agreements integer NOT NULL,
    median_gap_seconds double precision NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_pair_order CHECK ((user_a < user_b))
);

CREATE TABLE public.votes (
    id uuid NOT NULL,
    report_id uuid NOT NULL,
    voter_id uuid,
    device_id uuid,
    decision public.vote_decision NOT NULL,
    mode_claimed public.vote_mode NOT NULL,
    mode_verified public.vote_mode NOT NULL,
    distance_m double precision,
    gps_accuracy_m double precision,
    in_ward boolean,
    weight_at_vote double precision NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    replaced_at timestamp with time zone,
    CONSTRAINT ck_fixed_now_on_spot CHECK (((decision <> 'fixed_now'::public.vote_decision) OR (mode_verified = 'on_spot'::public.vote_mode)))
);

CREATE TABLE public.wards (
    id integer NOT NULL,
    name_en text NOT NULL,
    name_bn text NOT NULL,
    city_corp text,
    district text,
    geom public.geometry(MultiPolygon,4326),
    ref_point public.geography(Point,4326) NOT NULL,
    fallback_radius_m integer NOT NULL,
    source text,
    verified_by text,
    is_demo boolean DEFAULT false NOT NULL
);

CREATE SEQUENCE public.wards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.wards_id_seq OWNED BY public.wards.id;

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);

ALTER TABLE ONLY public.commodities ALTER COLUMN id SET DEFAULT nextval('public.commodities_id_seq'::regclass);

ALTER TABLE ONLY public.markets ALTER COLUMN id SET DEFAULT nextval('public.markets_id_seq'::regclass);

ALTER TABLE ONLY public.reputation_events ALTER COLUMN id SET DEFAULT nextval('public.reputation_events_id_seq'::regclass);

ALTER TABLE ONLY public.scoring_runs ALTER COLUMN id SET DEFAULT nextval('public.scoring_runs_id_seq'::regclass);

ALTER TABLE ONLY public.wards ALTER COLUMN id SET DEFAULT nextval('public.wards_id_seq'::regclass);

ALTER TABLE ONLY public.abuse_reports
    ADD CONSTRAINT abuse_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.capture_tokens
    ADD CONSTRAINT capture_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_code_key UNIQUE (code);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.collusion_alerts
    ADD CONSTRAINT collusion_alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commodities
    ADD CONSTRAINT commodities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_device_hash_key UNIQUE (device_hash);

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hotspots
    ADD CONSTRAINT hotspots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.label_final
    ADD CONSTRAINT label_final_pkey PRIMARY KEY (report_id);

ALTER TABLE ONLY public.label_import_batches
    ADD CONSTRAINT label_import_batches_file_sha256_key UNIQUE (file_sha256);

ALTER TABLE ONLY public.label_import_batches
    ADD CONSTRAINT label_import_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.live_days
    ADD CONSTRAINT live_days_pkey PRIMARY KEY (date);

ALTER TABLE ONLY public.markets
    ADD CONSTRAINT markets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.price_alert_watch
    ADD CONSTRAINT price_alert_watch_pkey PRIMARY KEY (user_id, commodity_id);

ALTER TABLE ONLY public.price_details
    ADD CONSTRAINT price_details_pkey PRIMARY KEY (report_id);

ALTER TABLE ONLY public.reference_prices
    ADD CONSTRAINT reference_prices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reputation_events
    ADD CONSTRAINT reputation_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.saved_posts
    ADD CONSTRAINT saved_posts_pkey PRIMARY KEY (user_id, report_id);

ALTER TABLE ONLY public.scoring_runs
    ADD CONSTRAINT scoring_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.trust_scores
    ADD CONSTRAINT trust_scores_pkey PRIMARY KEY (run_id, component, view);

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT uq_address UNIQUE (user_id, ward_id, kind);

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT uq_alert_cell_day UNIQUE (ward_id, category_id, test_date);

ALTER TABLE ONLY public.commodities
    ADD CONSTRAINT uq_commodity UNIQUE (name_en, variant, unit);

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT uq_label_per_annotator UNIQUE (report_id, annotator);

ALTER TABLE ONLY public.verified_prices
    ADD CONSTRAINT uq_verified_cell UNIQUE (commodity_id, market_id, date);

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.verified_prices
    ADD CONSTRAINT verified_prices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.voter_pairs
    ADD CONSTRAINT voter_pairs_pkey PRIMARY KEY (user_a, user_b);

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.wards
    ADD CONSTRAINT wards_pkey PRIMARY KEY (id);

CREATE INDEX idx_events_centroid ON public.events USING gist (centroid);

CREATE INDEX idx_hotspots_centroid ON public.hotspots USING gist (centroid);

CREATE INDEX idx_hotspots_hull ON public.hotspots USING gist (hull);

CREATE INDEX idx_markets_location ON public.markets USING gist (location);

CREATE INDEX idx_reports_location ON public.reports USING gist (location);

CREATE INDEX idx_wards_geom ON public.wards USING gist (geom);

CREATE INDEX idx_wards_ref_point ON public.wards USING gist (ref_point);

CREATE INDEX ix_abuse_reports_report_id ON public.abuse_reports USING btree (report_id);

CREATE INDEX ix_audit_actor_time ON public.audit_log USING btree (actor_id, created_at);

CREATE INDEX ix_audit_entity ON public.audit_log USING btree (entity, entity_id);

CREATE INDEX ix_capture_tokens_user_id ON public.capture_tokens USING btree (user_id);

CREATE INDEX ix_consents_user_id ON public.consents USING btree (user_id);

CREATE INDEX ix_devices_user_id ON public.devices USING btree (user_id);

CREATE INDEX ix_events_category_last_seen ON public.events USING btree (category_id, last_seen);

CREATE INDEX ix_evidence_sha256 ON public.evidence USING btree (sha256);

CREATE INDEX ix_notifications_unread ON public.notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);

CREATE INDEX ix_notifications_user_time ON public.notifications USING btree (user_id, created_at DESC);

CREATE INDEX ix_otp_codes_phone ON public.otp_codes USING btree (phone);

CREATE INDEX ix_price_cell ON public.price_details USING btree (commodity_id, market_id, observed_date);

CREATE INDEX ix_refresh_tokens_family_id ON public.refresh_tokens USING btree (family_id);

CREATE INDEX ix_refresh_tokens_user_id ON public.refresh_tokens USING btree (user_id);

CREATE INDEX ix_rep_current ON public.reputation_events USING btree (user_id) WHERE (superseded_at IS NULL);

CREATE INDEX ix_rep_source ON public.reputation_events USING btree (report_id, vote_id, user_id);

CREATE INDEX ix_reports_feed ON public.reports USING btree (ward_id, visibility, submitted_at DESC);

CREATE INDEX ix_reports_type_cat_time ON public.reports USING btree (report_type, category_id, submitted_at);

CREATE INDEX ix_reports_user_time ON public.reports USING btree (user_id, submitted_at);

CREATE INDEX ix_scoring_runs_report_id ON public.scoring_runs USING btree (report_id);

CREATE INDEX ix_user_addresses_user_id ON public.user_addresses USING btree (user_id);

CREATE INDEX ix_votes_active_report ON public.votes USING btree (report_id) WHERE (replaced_at IS NULL);

CREATE INDEX ix_votes_voter_time ON public.votes USING btree (voter_id, created_at);

CREATE UNIQUE INDEX uq_active_vote ON public.votes USING btree (report_id, voter_id) WHERE (replaced_at IS NULL);

ALTER TABLE ONLY public.abuse_reports
    ADD CONSTRAINT abuse_reports_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id);

ALTER TABLE ONLY public.abuse_reports
    ADD CONSTRAINT abuse_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_ward_id_fkey FOREIGN KEY (ward_id) REFERENCES public.wards(id);

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.capture_tokens
    ADD CONSTRAINT capture_tokens_renewed_from_id_fkey FOREIGN KEY (renewed_from_id) REFERENCES public.capture_tokens(id);

ALTER TABLE ONLY public.capture_tokens
    ADD CONSTRAINT capture_tokens_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id);

ALTER TABLE ONLY public.capture_tokens
    ADD CONSTRAINT capture_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.collusion_alerts
    ADD CONSTRAINT collusion_alerts_solved_by_fkey FOREIGN KEY (solved_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id);

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.capture_tokens(id);

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_vote_id_fkey FOREIGN KEY (vote_id) REFERENCES public.votes(id);

ALTER TABLE ONLY public.hotspots
    ADD CONSTRAINT hotspots_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.label_final
    ADD CONSTRAINT label_final_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id);

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.label_import_batches(id);

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id);

ALTER TABLE ONLY public.markets
    ADD CONSTRAINT markets_ward_id_fkey FOREIGN KEY (ward_id) REFERENCES public.wards(id);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.price_alert_watch
    ADD CONSTRAINT price_alert_watch_commodity_id_fkey FOREIGN KEY (commodity_id) REFERENCES public.commodities(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.price_alert_watch
    ADD CONSTRAINT price_alert_watch_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.price_details
    ADD CONSTRAINT price_details_commodity_id_fkey FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);

ALTER TABLE ONLY public.price_details
    ADD CONSTRAINT price_details_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);

ALTER TABLE ONLY public.price_details
    ADD CONSTRAINT price_details_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.reference_prices
    ADD CONSTRAINT reference_prices_commodity_id_fkey FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);

ALTER TABLE ONLY public.reference_prices
    ADD CONSTRAINT reference_prices_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_capture_token_id_fkey FOREIGN KEY (capture_token_id) REFERENCES public.capture_tokens(id);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_ward_id_fkey FOREIGN KEY (ward_id) REFERENCES public.wards(id);

ALTER TABLE ONLY public.reputation_events
    ADD CONSTRAINT reputation_events_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id);

ALTER TABLE ONLY public.reputation_events
    ADD CONSTRAINT reputation_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.reputation_events
    ADD CONSTRAINT reputation_events_vote_id_fkey FOREIGN KEY (vote_id) REFERENCES public.votes(id);

ALTER TABLE ONLY public.saved_posts
    ADD CONSTRAINT saved_posts_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.saved_posts
    ADD CONSTRAINT saved_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.scoring_runs
    ADD CONSTRAINT scoring_runs_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id);

ALTER TABLE ONLY public.trust_scores
    ADD CONSTRAINT trust_scores_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.scoring_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_ward_id_fkey FOREIGN KEY (ward_id) REFERENCES public.wards(id);

ALTER TABLE ONLY public.verified_prices
    ADD CONSTRAINT verified_prices_commodity_id_fkey FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);

ALTER TABLE ONLY public.verified_prices
    ADD CONSTRAINT verified_prices_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);

ALTER TABLE ONLY public.voter_pairs
    ADD CONSTRAINT voter_pairs_user_a_fkey FOREIGN KEY (user_a) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.voter_pairs
    ADD CONSTRAINT voter_pairs_user_b_fkey FOREIGN KEY (user_b) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id);

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_voter_id_fkey FOREIGN KEY (voter_id) REFERENCES public.users(id);
