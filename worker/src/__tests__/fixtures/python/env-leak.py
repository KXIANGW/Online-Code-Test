import os

# Check that secrets from the judge-worker process do NOT leak into the
# sandbox container. Worker env contains DATABASE_URL, RABBITMQ_URL, etc.;
# the sandbox container is spawned fresh with no inherited environment.
sensitive = ["DATABASE_URL", "RABBITMQ_URL", "JWT_SECRET", "REDIS_URL",
             "POSTGRES_PASSWORD", "RABBITMQ_PASS"]

for key in sensitive:
    if key in os.environ:
        print(f"LEAKED:{key}={os.environ[key][:8]}...")
    else:
        print(f"safe:{key}")