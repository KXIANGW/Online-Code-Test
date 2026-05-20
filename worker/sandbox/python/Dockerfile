FROM python:3.11-slim

# Non-root user UID 1000 to match runner.ts User: "1000:1000"
RUN useradd -u 1000 -m -d /home/runner -s /usr/sbin/nologin runner \
 && mkdir -p /code \
 && chown runner:runner /code

WORKDIR /code
USER runner
ENTRYPOINT []
