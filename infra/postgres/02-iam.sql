-- IAM module: users, roles, permissions, and junction tables
CREATE TABLE users (
  id            BIGSERIAL    PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(128),
  is_superuser  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE roles (
  id          BIGSERIAL    PRIMARY KEY,
  name        VARCHAR(64)  NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE permissions (
  id          BIGSERIAL    PRIMARY KEY,
  code        VARCHAR(64)  NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE user_roles (
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    BIGINT      NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE role_permissions (
  role_id       BIGINT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
