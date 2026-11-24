#!/usr/bin/env bash
# Fails if a file git would publish holds a secret, or is a file made to hold secrets.
#
# Usage: check-secrets.sh            (from anywhere inside the repository)
#
# Why: the repository is public. A key pushed once stays in the history, in every fork and
# in caches, even after a revert; the only fix is rotating it. `.gitignore` keeps `.env`
# out, but not `git add -f`, a renamed copy or a key pasted into a test.
#
# Checks every tracked or new (not ignored) file, which is what the next commit can carry:
#   1. its name is not one of a secrets file: `.env` or `.env.*` other than `.env.example`,
#      Terraform state, or a `.tfvars` other than `*.tfvars.example`;
#   2. no line matches a secret shape (SECRET_RULES below).
# Only the file, the line number and the rule are printed, never the line: printing it
# would copy the secret into the CI log.
#
# A pattern catches the shapes it knows, not every secret. A value that only names a
# variable (`=$VAR`, `=${{ secrets.X }}`) is a reference, not a secret, and passes.
# guards/check-secrets.test.sh plants each shape and checks that this guard catches it.
#
# Exit code: 0 when clean, 1 when something is found, 2 when nothing could be checked
# (not a git repository, no file, or a git error). Check the code, not the text.
set -u

# "<rule> <extended regex>": the rule name ends at the first space. Each regex breaks its
# own literal text with a bracket or a parenthesis, so this file does not match itself.
SECRET_RULES=(
  "anthropic-api-key sk-ant-[A-Za-z0-9_-]{20,}"
  "aws-access-key (AKIA|ASIA)[0-9A-Z]{16}"
  "private-key -----BEGIN ([A-Z0-9]+ )*PRIVATE KEY( BLOCK)?-----"
  "github-token gh[pousr]_[A-Za-z0-9]{36,}"
  "github-token github_pat_[A-Za-z0-9_]{22,}"
  # A value right after `=`, quoted or not; `$` starts a reference, not a value.
  "postgres-password POSTGRES_PASSWORD[[:space:]]*=[[:space:]]*[\"']?[^[:space:]\"'\$]"
  # user:password@ inside a connection URL; `$` again marks an interpolated reference.
  "postgres-url-password postgres(ql)?://[^:/@[:space:]]+:[^@/[:space:]\$]+@"
)

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

git rev-parse --is-inside-work-tree > /dev/null 2>&1 \
  || { echo "not inside a git repository; nothing was checked"; exit 2; }
cd "$(git rev-parse --show-toplevel)" || { echo "cannot enter the repository root"; exit 2; }

files=()
while IFS= read -r -d '' f; do
  files+=("$f")
done < <(git -c core.quotePath=false ls-files -z --cached --others --exclude-standard)
[ "${#files[@]}" -gt 0 ] || { echo "no tracked or new file; nothing was checked"; exit 2; }

found=0
for f in "${files[@]}"; do
  reason="$(secret_file_reason "$f")"
  if [ -n "$reason" ]; then
    echo "FAIL  $f: $reason"
    found=1
  fi
done

for rule in "${SECRET_RULES[@]}"; do
  name="${rule%% *}"
  regex="${rule#* }"
  # The same files as above: tracked ones plus, with --untracked, new ones not ignored.
  # git grep and not grep over the list: no argument-length limit, which Windows sets at
  # 32K characters for a whole command line. -I skips binary files.
  out="$(git -c core.quotePath=false grep --untracked --no-color -I -n -E -e "$regex")"
  status=$?
  if [ "$status" -eq 0 ]; then
    # "file:line:text" -> "file:line"; the text stays out of the log.
    printf '%s\n' "$out" | cut -d: -f1,2 | sed "s|^|FAIL  |; s|\$|: $name|"
    found=1
  elif [ "$status" -gt 1 ]; then
    echo "error: git grep failed with status $status on rule $name; nothing was checked"
    exit 2
  fi
done

if [ "$found" -eq 1 ]; then
  echo "secrets or secret files found (see above). Remove them; a pushed key must be rotated"
  exit 1
fi
echo "clean: no secret shapes or secret files in ${#files[@]} file(s)"
