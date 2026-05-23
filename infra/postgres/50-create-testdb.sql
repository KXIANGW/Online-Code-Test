-- Creates oct_test as a full template clone of oct.
--
-- IMPORTANT: This file is intentionally numbered 50 so it runs AFTER all
-- schema migration files (00–49). Every new schema file must be numbered
-- below 50, otherwise oct_test will be cloned before that schema exists
-- and backend tests will fail with "relation does not exist".
--
-- Switch to neutral DB so oct has no active connections from this script,
-- which is required for CREATE DATABASE ... WITH TEMPLATE oct.
\c postgres
CREATE DATABASE oct_test WITH TEMPLATE oct OWNER oct;
