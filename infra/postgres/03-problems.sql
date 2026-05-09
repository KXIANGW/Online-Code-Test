-- Problem module: language_defaults, problems, testcases, per-language limits
CREATE TABLE language_defaults (
  language          VARCHAR(32)  PRIMARY KEY,
  display_name      VARCHAR(64)  NOT NULL,
  time_multiplier   NUMERIC(4,2) NOT NULL DEFAULT 1.0 CHECK (time_multiplier > 0),
  memory_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0 CHECK (memory_multiplier > 0),
  is_enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE problems (
  id              BIGSERIAL        PRIMARY KEY,
  title           VARCHAR(255)     NOT NULL,
  description_md  TEXT             NOT NULL,
  difficulty      difficulty_level NOT NULL,
  time_limit_ms   INT              NOT NULL CHECK (time_limit_ms > 0),
  memory_limit_mb INT              NOT NULL CHECK (memory_limit_mb > 0),
  output_limit_kb INT              NOT NULL DEFAULT 64 CHECK (output_limit_kb > 0),
  created_by      BIGINT           NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE problem_testcases (
  id              BIGSERIAL   PRIMARY KEY,
  problem_id      BIGINT      NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  order_index     INT         NOT NULL,
  is_public       BOOLEAN     NOT NULL DEFAULT FALSE,
  input_data      TEXT        NOT NULL,
  expected_output TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (problem_id, order_index)
);

-- Per-problem language overrides; absence means use language_defaults values
CREATE TABLE problem_language_limits (
  problem_id        BIGINT       NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  language          VARCHAR(32)  NOT NULL REFERENCES language_defaults(language),
  time_multiplier   NUMERIC(4,2) NOT NULL CHECK (time_multiplier > 0),
  memory_multiplier NUMERIC(4,2) NOT NULL CHECK (memory_multiplier > 0),
  PRIMARY KEY (problem_id, language)
);
