-- Ensure docspyre_app and litellm databases exist for Compass Platform
SELECT 'CREATE DATABASE docspyre_app' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'docspyre_app')\gexec
SELECT 'CREATE DATABASE litellm' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'litellm')\gexec
GRANT ALL PRIVILEGES ON DATABASE docspyre_app TO postgres;
GRANT ALL PRIVILEGES ON DATABASE litellm TO postgres;
