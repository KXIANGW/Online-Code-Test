/*
 * oct-seccomp-wrapper — second-stage exec helper for IsolateEngine.
 *
 * Upstream isolate v2.0 has no --seccomp-policy flag, so we run isolate
 * with this binary as the entry point and let it install a seccomp-bpf
 * filter just before execve()'ing the real candidate command.
 *
 * Policy file format (same as worker/sandbox/isolate-seccomp.policy,
 * already used by docs and tests):
 *
 *     # comment
 *     <action> <syscall-name>
 *
 *   action ∈ { allow, errno, kill, log, trap }
 *   The default action for any syscall NOT named in the policy is `allow`.
 *   For action=errno, the wrapper returns ENOSYS (38) — matching
 *   Docker's docker-default seccomp profile semantics.
 *
 * Invocation:
 *     oct-seccomp-wrapper POLICY_PATH -- CMD [ARGS...]
 *
 * The wrapper:
 *   1. Parses the policy and builds a libseccomp filter.
 *   2. prctl(PR_SET_NO_NEW_PRIVS) — mandatory for unprivileged seccomp.
 *   3. seccomp_load() — applies the filter to this process and any
 *      descendants/execve()'d children.
 *   4. execvp() the candidate command.
 *
 * Exit codes (only meaningful when execvp itself fails or args are bad):
 *   0   — never (we always exec)
 *   2   — usage / setup error
 */

#define _GNU_SOURCE
#include <errno.h>
#include <seccomp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <unistd.h>

static void die(const char *msg) {
  fprintf(stderr, "oct-seccomp-wrapper: %s: %s\n", msg, strerror(errno));
  exit(2);
}

static int parse_action(const char *name, uint32_t *out) {
  if (strcmp(name, "allow") == 0) { *out = SCMP_ACT_ALLOW;            return 0; }
  if (strcmp(name, "kill")  == 0) { *out = SCMP_ACT_KILL_PROCESS;     return 0; }
  if (strcmp(name, "errno") == 0) { *out = SCMP_ACT_ERRNO(ENOSYS);    return 0; }
  if (strcmp(name, "log")   == 0) { *out = SCMP_ACT_LOG;              return 0; }
  if (strcmp(name, "trap")  == 0) { *out = SCMP_ACT_TRAP;             return 0; }
  return -1;
}

static char *trim(char *s) {
  while (*s == ' ' || *s == '\t') s++;
  size_t n = strlen(s);
  while (n > 0 && (s[n - 1] == '\n' || s[n - 1] == '\r' ||
                   s[n - 1] == ' '  || s[n - 1] == '\t')) {
    s[--n] = '\0';
  }
  return s;
}

int main(int argc, char **argv) {
  if (argc < 4 || strcmp(argv[2], "--") != 0) {
    fprintf(stderr, "usage: %s POLICY_PATH -- CMD [ARGS...]\n",
            argc > 0 ? argv[0] : "oct-seccomp-wrapper");
    return 2;
  }

  const char *policy_path = argv[1];
  FILE *fp = fopen(policy_path, "r");
  if (!fp) die("open policy");

  /* Default action ALLOW; the policy file specifies the deny/errno list. */
  scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_ALLOW);
  if (!ctx) {
    fprintf(stderr, "oct-seccomp-wrapper: seccomp_init failed\n");
    return 2;
  }

  char line[256];
  int line_no = 0;
  int unknown_syscalls = 0;
  while (fgets(line, sizeof(line), fp)) {
    line_no++;
    /* Strip '#' comments. */
    char *hash = strchr(line, '#');
    if (hash) *hash = '\0';
    char *p = trim(line);
    if (*p == '\0') continue;

    char action_str[32];
    char syscall_name[64];
    int matched = sscanf(p, "%31s %63s", action_str, syscall_name);
    if (matched != 2) {
      fprintf(stderr, "oct-seccomp-wrapper: malformed line %d: %s\n", line_no, p);
      continue;
    }

    uint32_t action;
    if (parse_action(action_str, &action) != 0) {
      fprintf(stderr, "oct-seccomp-wrapper: unknown action '%s' at line %d\n",
              action_str, line_no);
      continue;
    }

    int nr = seccomp_syscall_resolve_name(syscall_name);
    if (nr == __NR_SCMP_ERROR) {
      /* Syscall doesn't exist on this kernel/arch — skip silently, matches
       * how Docker handles arch-specific names in its default profile. */
      unknown_syscalls++;
      continue;
    }
    if (seccomp_rule_add(ctx, action, nr, 0) < 0) {
      fprintf(stderr, "oct-seccomp-wrapper: rule_add %s failed: %s\n",
              syscall_name, strerror(errno));
    }
  }
  fclose(fp);

  /* PR_SET_NO_NEW_PRIVS is required when not running as root with
   * CAP_SYS_ADMIN. Without it seccomp_load() returns EACCES. */
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) {
    die("prctl PR_SET_NO_NEW_PRIVS");
  }

  if (seccomp_load(ctx) < 0) {
    die("seccomp_load");
  }
  seccomp_release(ctx);

  /* execvp does PATH lookup; the candidate cmd as provided by IsolateEngine
   * is already absolute, but allow either form. argv[3] is the program;
   * &argv[3] is the full argv array for it (NULL-terminated by libc). */
  execvp(argv[3], &argv[3]);
  die("execvp");
  return 2;
}
