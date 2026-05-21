-- Switch to neutral DB so oct has no active connections from this script,
-- which is required for CREATE DATABASE ... WITH TEMPLATE oct.
\c postgres
CREATE DATABASE oct_test WITH TEMPLATE oct OWNER oct;
