#!/bin/sh
set -e

# Fix permissions on bind-mounted volumes that Docker creates as root.
# The Dockerfile sets correct ownership in the image layer (chown app:app /data),
# but when ./data doesn't exist on the host, Docker daemon creates it as root
# and the bind mount obscures the image's permission setup. This runs as root
# before dropping privileges, so the fix always applies.
chown -R app:app /data 2>/dev/null || true

# If the Docker socket is bind-mounted (PULLMD_OLLAMA_MANAGED support), grant
# the unprivileged app user group access to it so it can reach the Docker
# Engine API at runtime. Busybox has no `getent`, so look up the group by
# gid via /etc/group directly. No-op when the socket isn't mounted.
if [ -S /var/run/docker.sock ]; then
  sock_gid="$(stat -c '%g' /var/run/docker.sock)"
  group_name="$(awk -F: -v gid="$sock_gid" '$3==gid{print $1}' /etc/group)"
  if [ -z "$group_name" ]; then
    group_name="docker-host"
    addgroup -g "$sock_gid" "$group_name" 2>/dev/null || true
  fi
  addgroup app "$group_name" 2>/dev/null || true
fi

# Preserve the node-wrapping logic from the node base image: if the first arg
# starts with "-" or isn't a known command, prepend "node".
if [ "${1#-}" != "${1}" ] || [ -z "$(command -v "${1}")" ] || { [ -f "${1}" ] && ! [ -x "${1}" ]; }; then
  set -- node "$@"
fi

# Drop to the unprivileged app user and run the command. Deliberately omit
# the ":app" group suffix: su-exec only calls initgroups() (picking up ALL
# of app's supplementary groups, e.g. the docker-host group added above)
# when no explicit group is given — "user:group" syntax sets just that one
# gid via setgroups() and silently drops every other supplementary group.
exec su-exec app "$@"
