-- Runs once, on a fresh Postgres volume only (docker-entrypoint-initdb.d).
-- Integration tests use this separate database so they can wipe it freely.
CREATE DATABASE pocketpay_test OWNER pocketpay;
