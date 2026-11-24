#!/usr/bin/env bash
# Positive controls for check-secrets.sh: plants each secret shape and each secrets file in
# a throwaway repository and checks that the guard catches it for the right reason.
#
# Usage: check-secrets.test.sh
#
# Why: a guard that never fails looks exactly like a clean repository. Each case asserts
# the exit code, the rule named in the output and, for a secret, that the output does not
# repeat it (the guard must not leak what it finds into the CI log).
#
# Exit code: 0 when every case passes, 1 when one fails.
set -u

guard="$(cd "$(dirname "$0")" && pwd)/check-secrets.sh"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

repeat() { printf "%${2}s" '' | tr ' ' "$1"; }

# Built from pieces so this file never matches the guard it tests.
ANTHROPIC_KEY="sk-""ant-api03-$(repeat A 40)"
AWS_KEY="AKI""A$(repeat B 16)"
PRIVATE_KEY_HEADER="-----BEGIN OPENSSH ""PRIVATE KEY-----"
GITHUB_TOKEN="gh""p_$(repeat c 36)"
GITHUB_PAT="github""_pat_$(repeat d 40)"
PG_PASSWORD="POSTGRES""_PASSWORD=local-not-a-real-one"
PG_URL="postgres""ql://circuit_admin:local-not-a-real-one@127.0.0.1:5432/circuit"

case_number=0
checks=0
failures=0

new_repo() {
  case_number=$((case_number + 1))
  repo="$workdir/case-$case_number"
  mkdir "$repo" && git -C "$repo" init -q
  # Keeps a machine-wide autocrlf from printing a warning for every planted file.
  git -C "$repo" config core.autocrlf false
}

# expect <description> <exit code> <text the output must contain> [<text it must not contain>]
expect() {
  local description="$1" want_code="$2" want_text="$3" secret="${4:-}" out code
  checks=$((checks + 1))
  out="$(cd "$repo" && bash "$guard" 2>&1)"
  code=$?
  local problem=""
  [ "$code" -eq "$want_code" ] || problem="exit $code, expected $want_code"
  case "$out" in *"$want_text"*) ;; *) problem="${problem:+$problem; }output lacks '$want_text'" ;; esac
  if [ -n "$secret" ]; then
    case "$out" in *"$secret"*) problem="${problem:+$problem; }output repeats the secret" ;; esac
  fi
  if [ -n "$problem" ]; then
    echo "FAIL  $description: $problem"
    printf '%s\n' "$out" | sed 's/^/        /'
    failures=$((failures + 1))
  else
    echo "ok    $description"
  fi
}

# plant <file> <content> <git add flag or "untracked">
plant() {
  printf 'line one\n%s\n' "$2" > "$repo/$1"
  [ "$3" = "untracked" ] || git -C "$repo" add $3 -- "$1"
}

# Nothing to check is not "clean".
new_repo
expect "empty repository" 2 "nothing was checked"
checks=$((checks + 1))
(cd "$workdir" && bash "$guard" > /dev/null 2>&1)
[ $? -eq 2 ] && echo "ok    outside a repository" \
  || { echo "FAIL  outside a repository: expected exit 2"; failures=$((failures + 1)); }

# References and empty values are not secrets: the clean baseline checks real files.
new_repo
plant ci.yml 'POSTGRES_PASSWORD=${{ secrets.DB }}' ""
plant .env.example 'POSTGRES_PASSWORD=' ""
plant url.ts 'const url = `postgres://${user}:${password}@localhost`;' ""
expect "references and empty values pass" 0 "in 3 file(s)"

# Each secret shape, in a tracked file.
for planted in \
  "anthropic-api-key|$ANTHROPIC_KEY" \
  "aws-access-key|$AWS_KEY" \
  "private-key|$PRIVATE_KEY_HEADER" \
  "github-token|$GITHUB_TOKEN" \
  "github-token|$GITHUB_PAT" \
  "postgres-password|$PG_PASSWORD" \
  "postgres-url-password|$PG_URL"; do
  rule="${planted%%|*}"
  secret="${planted#*|}"
  new_repo
  plant config.ts "$secret" ""
  expect "$rule in a tracked file" 1 "config.ts:2: $rule" "$secret"
done

# A new file the next `git add -A` would pick up counts; an ignored one does not.
new_repo
plant notes.txt "$ANTHROPIC_KEY" untracked
expect "secret in a new, not ignored file" 1 "notes.txt:2: anthropic-api-key" "$ANTHROPIC_KEY"
new_repo
printf '.env\n' > "$repo/.gitignore"
plant .env "$PG_PASSWORD" untracked
expect "secret in an ignored .env passes" 0 "clean"

# Secrets files, whatever they hold.
for planted in ".env|-f" ".env.local|-f" "infra/terraform.tfstate|-f" "infra/prod.tfvars|-f"; do
  file="${planted%%|*}"
  new_repo
  mkdir -p "$repo/infra"
  plant "$file" "harmless" "${planted#*|}"
  expect "$file is a secrets file" 1 "FAIL  $file:"
done

if [ "$failures" -gt 0 ]; then
  echo "$failures of $checks case(s) failed"
  exit 1
fi
echo "all $checks check-secrets cases pass"
