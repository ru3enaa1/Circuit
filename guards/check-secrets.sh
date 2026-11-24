#!/usr/bin/env bash
# Fails if a file git would publish holds a secret, or is a file made to hold secrets.
#
# Usage: check-secrets.sh                     what the next commit can carry
#        check-secrets.sh --range <range>     every commit in a range, for a pre-push hook
#                                             (for example origin/feat/f0-base..HEAD)
#
# Why: the repository is public. A key pushed once stays in the history, in every fork and
# in caches, even after a revert; the only fix is rotating it. `.gitignore` keeps `.env`
# out, but not `git add -f`, a renamed copy or a key pasted into a test.
#
# Without arguments it checks what the next commit can carry: every tracked or new (not
# ignored) file in the working tree, and the index, where a staged version can hold a
# secret the file on disk no longer has. With --range it checks the tree of every commit
# in the range instead: a key added in one commit and removed in the next is gone from the
# head, not from the history a push publishes. CI runs the first form after the push, so
# it detects; only a pre-push hook with --range prevents. In both forms:
#   1. no file name is one of a secrets file: `.env` or `.env.*` other than `.env.example`,
#      Terraform state, or a `.tfvars` other than `*.tfvars.example`;
#   2. no line matches a secret shape (SECRET_RULES below).
# Only the commit (with --range), the file, the line number and the rule are printed,
# never the line: printing it would copy the secret into the CI log.
#
# A pattern catches the shapes it knows, not every secret. A value that only names a
# variable (`=$VAR`, `=${{ secrets.X }}`) is a reference, not a secret, and passes.
# guards/check-secrets.test.sh plants each shape and checks that this guard catches it.
#
# Exit code: 0 when clean, 1 when something is found, 2 when nothing could be checked
# (not a git repository, no file or commit, a bad argument or a git error). Check the
# code, not the text.
set -u

# "<rule> <paths> <extended regex>": the name ends at the first space and the paths at the
# second. Paths are comma-separated git pathspecs, where `.` is every file and `*` also
# crosses `/`. Each regex breaks its own literal text with a bracket or a parenthesis, so
# this file does not match itself.
SECRET_RULES=(
  "anthropic-api-key . sk-ant-[A-Za-z0-9_-]{20,}"
  "aws-access-key . (AKIA|ASIA)[0-9A-Z]{16}"
  "private-key . -----BEGIN ([A-Z0-9]+ )*PRIVATE KEY( BLOCK)?-----"
  "github-token . gh[pousr]_[A-Za-z0-9]{36,}"
  "github-token . github_pat_[A-Za-z0-9_]{22,}"
  # A value right after `=`, quoted or not; `$` starts a reference, not a value.
  "postgres-password . POSTGRES_PASSWORD[[:space:]]*=[[:space:]]*[\"']?[^[:space:]\"'\$]"
  # The YAML form, a key, `:` and a value, as compose.yaml or a workflow `env:` writes it.
  # Only in YAML and only as a key that starts the line: in TypeScript `POSTGRES_PASSWORD:
  # SECRET` names a constant, and in `${POSTGRES_PASSWORD:?message}` the `:` starts a
  # message. After the `:`, `#` starts a YAML comment, not a value.
  "postgres-password *.yml,*.yaml ^[[:space:]]*(- )?[\"']?POSTGRES_PASSWORD[\"']?[[:space:]]*:[[:space:]]*[\"']?[^[:space:]\"'\$#]"
  # user:password@ inside a connection URL; `$` again marks an interpolated reference.
  "postgres-url-password . postgres(ql)?://[^:/@[:space:]]+:[^@/[:space:]\$]+@"
)

# Set to 1 by any finding; read once, at the end.
found=0

# Prints why a path names a file made to hold secrets, or nothing. The examples pass: they
# carry the variable names with empty values.
secret_file_reason() {
  case "${1##*/}" in
    .env.example | *.tfvars.example) ;;
    .env | .env.*) echo "env file; only .env.example is published" ;;
    *.tfstate | *.tfstate.*) echo "Terraform state, which keeps secrets in plain text" ;;
    *.tfvars) echo "Terraform variables file; only *.tfvars.example is published" ;;
  esac
}

# report_secret_files <prefix> <path>...: one FAIL line per secrets file. The prefix is
# the commit, with --range.
report_secret_files() {
  local prefix="$1" f reason
  shift
  for f in "$@"; do
    reason="$(secret_file_reason "$f")"
    if [ -n "$reason" ]; then
      echo "FAIL  $prefix$f: $reason"
      found=1
    fi
  done
}

# next_commit_hits <regex> <pathspec>...: prints "file:line" for each matching line in the
# working tree (tracked files and new ones not ignored) and in the index. git grep reads
# one of them per call; a line found in both prints once. git grep and not grep over a
# file list: no argument-length limit, which Windows sets at 32K characters. -I skips
# binary files. Returns 0 when it found something, 1 when not and 2 on a git error.
next_commit_hits() {
  local regex="$1" source out status hits="" result=1
  shift
  for source in --untracked --cached; do
    out="$(git -c core.quotePath=false grep "$source" --no-color -I -n -E -e "$regex" -- "$@")"
    status=$?
    [ "$status" -le 1 ] || return 2
    [ "$status" -eq 1 ] || { hits+="$out"$'\n'; result=0; }
  done
  # "file:line:text" -> "file:line"; the text stays out of the log.
  [ "$result" -eq 1 ] || printf '%s' "$hits" | cut -d: -f1,2 | sort -u
  return "$result"
}

# commit_hits <commit> <regex> <pathspec>...: prints "commit:file:line" for each matching
# line in that commit's tree. Returns 0 when it found something, 1 when not, 2 on an error.
commit_hits() {
  local commit="$1" regex="$2" out status
  shift 2
  out="$(git -c core.quotePath=false grep --no-color -I -n -E -e "$regex" "$commit" -- "$@")"
  status=$?
  [ "$status" -le 1 ] || return 2
  [ "$status" -eq 0 ] || return 1
  # "commit:file:line:text" -> "commit:file:line"
  printf '%s\n' "$out" | cut -d: -f1,2,3
}

# report_secret_lines <target>: runs every rule over "next-commit" or over a commit, with
# one FAIL line per hit. A rule that could not run is not clean: exits with 2.
report_secret_lines() {
  local target="$1" rule name rest regex paths out status
  for rule in "${SECRET_RULES[@]}"; do
    name="${rule%% *}"
    rest="${rule#* }"
    regex="${rest#* }"
    IFS=, read -r -a paths <<< "${rest%% *}"
    if [ "$target" = next-commit ]; then
      out="$(next_commit_hits "$regex" "${paths[@]}")"
    else
      out="$(commit_hits "$target" "$regex" "${paths[@]}")"
    fi
    status=$?
    if [ "$status" -eq 0 ]; then
      printf '%s\n' "$out" | sed "s|^|FAIL  |; s|\$|: $name|"
      found=1
    elif [ "$status" -gt 1 ]; then
      echo "error: git grep failed on rule $name in $target; nothing was checked"
      exit 2
    fi
  done
}

check_next_commit() {
  local files=()
  mapfile -d '' -t files < <(git -c core.quotePath=false ls-files -z --cached --others --exclude-standard)
  [ "${#files[@]}" -gt 0 ] || { echo "no tracked or new file; nothing was checked"; exit 2; }
  report_secret_files "" "${files[@]}"
  report_secret_lines next-commit
  finish "${#files[@]} file(s)"
}

check_range() {
  local range="$1" list commits=() commit files=()
  # --end-of-options: a range that starts with `-` is read as a revision, never an option.
  list="$(git rev-list --abbrev-commit --end-of-options "$range")" \
    || { echo "cannot list the commits in '$range'; nothing was checked"; exit 2; }
  [ -n "$list" ] || { echo "no commit in '$range'; nothing was checked"; exit 2; }
  mapfile -t commits <<< "$list"
  for commit in "${commits[@]}"; do
    mapfile -d '' -t files < <(git -c core.quotePath=false ls-tree -r -z --name-only "$commit")
    report_secret_files "$commit:" "${files[@]}"
    report_secret_lines "$commit"
  done
  finish "${#commits[@]} commit(s)"
}

# finish <what was checked>: the verdict and the exit code.
finish() {
  if [ "$found" -eq 1 ]; then
    echo "secrets or secret files found (see above). Remove them from every commit that has them; a pushed key must be rotated"
    exit 1
  fi
  echo "clean: no secret shapes or secret files in $1"
  exit 0
}

git rev-parse --is-inside-work-tree > /dev/null 2>&1 \
  || { echo "not inside a git repository; nothing was checked"; exit 2; }
cd "$(git rev-parse --show-toplevel)" || { echo "cannot enter the repository root"; exit 2; }

case "$#:${1:-}" in
  0:) check_next_commit ;;
  2:--range) check_range "$2" ;;
  *) echo "usage: check-secrets.sh [--range <revision range>]; nothing was checked"; exit 2 ;;
esac
