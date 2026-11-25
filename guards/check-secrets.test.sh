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
# The YAML form, as compose.yaml or a workflow `env:` would write a literal value.
PG_PASSWORD_YAML="      POSTGRES""_PASSWORD: local-not-a-real-one"
PG_URL="postgres""ql://circuit_admin:local-not-a-real-one@127.0.0.1:5432/circuit"
# ADR-0008 D1: `crmk_` and 43 characters of base64url, `_` and `-` among them.
CRM_PREFIX="crm""k_"
CRM_TAIL="$(repeat a 20)_-$(repeat B 21)"
CRM_KEY="$CRM_PREFIX$CRM_TAIL"

case_number=0
checks=0
failures=0
# Arguments for the guard in the next expect; new_repo empties them.
guard_args=()

new_repo() {
  case_number=$((case_number + 1))
  repo="$workdir/case-$case_number"
  guard_args=()
  mkdir "$repo" && git -C "$repo" init -q
  # Keeps a machine-wide autocrlf from printing a warning for every planted file.
  git -C "$repo" config core.autocrlf false
}

# commit <message>: a fixed identity and no signing, so the machine's git configuration
# cannot make a case fail.
commit() {
  git -C "$repo" -c user.name=check-secrets-test -c user.email=test@example.invalid \
    -c commit.gpgsign=false commit -q -m "$1"
}

# expect <description> <exit code> <text the output must contain> [<text it must not contain>]
expect() {
  local description="$1" want_code="$2" want_text="$3" secret="${4:-}" out code
  checks=$((checks + 1))
  out="$(cd "$repo" && bash "$guard" ${guard_args[@]+"${guard_args[@]}"} 2>&1)"
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

# plant <file> <content> <git add flag, or "no-add" to leave the index as it is>
plant() {
  printf 'line one\n%s\n' "$2" > "$repo/$1"
  [ "$3" = "no-add" ] || git -C "$repo" add $3 -- "$1"
}

# Nothing to check is not "clean".
new_repo
expect "empty repository" 2 "nothing was checked"
checks=$((checks + 1))
(cd "$workdir" && bash "$guard" > /dev/null 2>&1)
[ $? -eq 2 ] && echo "ok    outside a repository" \
  || { echo "FAIL  outside a repository: expected exit 2"; failures=$((failures + 1)); }

# References and empty values are not secrets: the clean baseline checks real files. The
# last two would match the YAML rule if it read every file, or any `:` after the name.
new_repo
plant ci.yml $'POSTGRES_PASSWORD=${{ secrets.DB }}\n          POSTGRES_PASSWORD: ${{ secrets.DB }}' ""
plant .env.example 'POSTGRES_PASSWORD=' ""
plant url.ts 'const url = `postgres://${user}:${password}@localhost`;' ""
plant compose.yaml $'      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set it in .env}\n      POSTGRES_PASSWORD:  # set in .env' ""
plant env.ts '  POSTGRES_PASSWORD: SECRET,' ""
expect "references and empty values pass" 0 "in 5 file(s)"

# Each secret shape, in a tracked file.
for planted in \
  "anthropic-api-key|$ANTHROPIC_KEY" \
  "aws-access-key|$AWS_KEY" \
  "private-key|$PRIVATE_KEY_HEADER" \
  "github-token|$GITHUB_TOKEN" \
  "github-token|$GITHUB_PAT" \
  "postgres-password|$PG_PASSWORD" \
  "postgres-url-password|$PG_URL" \
  "crm-api-key|$CRM_KEY"; do
  rule="${planted%%|*}"
  secret="${planted#*|}"
  new_repo
  plant config.ts "$secret" ""
  expect "$rule in a tracked file" 1 "config.ts:2: $rule" "$secret"
done

# ADR-0008 D15: a CRM key inside code, between quotes, as a copy from the terminal would land.
new_repo
plant client.ts "const key = '$CRM_KEY';" ""
expect "crm-api-key between quotes in a .ts" 1 "client.ts:2: crm-api-key" "$CRM_TAIL"
# Its controls: the rule's own text, the shape in keys.ts, a template and a run one character
# too long are not keys. The rule is read from the guard, so the control follows any change.
new_repo
plant rule.sh "$(grep -F '"crm-api-key ' "$guard")" ""
plant keys.ts "export const API_KEY_SHAPE = /^${CRM_PREFIX}[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]\$/;"$'\n'"const key = \`${CRM_PREFIX}\${tail}\`;" ""
plant long.ts "${CRM_KEY}x" ""
expect "the rule, the shape, a template and 44 characters pass" 0 "in 3 file(s)"

# The YAML form, at the root and deep in the tree.
for file in compose.yaml .github/workflows/ci.yml; do
  new_repo
  mkdir -p "$repo/.github/workflows"
  plant "$file" "$PG_PASSWORD_YAML" ""
  expect "postgres-password, YAML form, in $file" 1 "$file:2: postgres-password" "local-not-a-real-one"
done

# A new file the next `git add -A` would pick up counts; an ignored one does not.
new_repo
plant notes.txt "$ANTHROPIC_KEY" no-add
expect "secret in a new, not ignored file" 1 "notes.txt:2: anthropic-api-key" "$ANTHROPIC_KEY"
new_repo
printf '.env\n' > "$repo/.gitignore"
plant .env "$PG_PASSWORD" no-add
expect "secret in an ignored .env passes" 0 "clean"

# The next commit carries what is staged, even when the file on disk no longer has it.
new_repo
plant config.ts "$ANTHROPIC_KEY" ""
plant config.ts "harmless" no-add
expect "secret only in the staged version" 1 "config.ts:2: anthropic-api-key" "$ANTHROPIC_KEY"

# Secrets files, whatever they hold.
for planted in ".env|-f" ".env.local|-f" "infra/terraform.tfstate|-f" "infra/prod.tfvars|-f"; do
  file="${planted%%|*}"
  new_repo
  mkdir -p "$repo/infra"
  plant "$file" "harmless" "${planted#*|}"
  expect "$file is a secrets file" 1 "FAIL  $file:"
done

# A key and a secrets file added in one commit and removed in the next: the head is clean,
# the history a push would publish is not.
new_repo
plant base.txt "harmless" ""
commit "base"
base="$(git -C "$repo" rev-parse HEAD)"
plant leak.txt "$ANTHROPIC_KEY" ""
plant .env "harmless" -f
commit "adds a key and a secrets file"
added="$(git -C "$repo" rev-parse --short HEAD)"
git -C "$repo" rm -q -- leak.txt .env
commit "removes them"
expect "a key removed in a later commit is gone from the head" 0 "clean"
guard_args=(--range "$base..HEAD")
expect "--range finds the key in the commit that added it" 1 "$added:leak.txt:2: anthropic-api-key" "$ANTHROPIC_KEY"
expect "--range finds the secrets file in that commit" 1 "FAIL  $added:.env: env file"

# ADR-0008 A2: a push publishes each message too. A key pasted into a message, with clean
# files, is found by --range, and only there: the next commit has no message yet.
new_repo
plant base.txt "harmless" ""
commit "base"
base="$(git -C "$repo" rev-parse HEAD)"
plant notes.txt "harmless too" ""
commit "$(printf 'fix: pega la salida de db:keys\n\nla llave es %s' "$CRM_KEY")"
pasted="$(git -C "$repo" rev-parse --short HEAD)"
expect "a key only in a commit message is not in the next commit" 0 "clean"
guard_args=(--range "$base..HEAD")
expect "--range finds a key in a commit message" 1 "FAIL  $pasted:(message):3: crm-api-key" "$CRM_TAIL"
# Its control: a message that only names a secret passes. The last two lines would fail if
# the YAML form read messages (a line that starts with the variable and `:`), or if the CRM
# rule took 44 characters for a key.
new_repo
plant notes.txt "harmless" ""
# Single quotes on purpose: the `$` and the template are the text of the message.
commit "$(printf 'docs: POSTGRES_PASSWORD=$VAR y la forma `%s${tail}`\n\nPOSTGRES_PASSWORD: sale de .env\n%sx' "$CRM_PREFIX" "$CRM_KEY")"
guard_args=(--range HEAD)
expect "--range: a message that only names a secret passes" 0 "clean: no secret shapes or secret files in 1 commit(s)"
# Each refusal names its own reason: a later check failing by accident is not this one.
guard_args=(--range HEAD..HEAD)
expect "--range with no commit checks nothing" 2 "no commit in 'HEAD..HEAD'; nothing was checked"
guard_args=(--range no-such-revision)
expect "--range with a bad revision checks nothing" 2 "cannot list the commits in 'no-such-revision'; nothing was checked"
guard_args=(--range)
expect "--range without a value checks nothing" 2 "nothing was checked"

if [ "$failures" -gt 0 ]; then
  echo "$failures of $checks case(s) failed"
  exit 1
fi
echo "all $checks check-secrets cases pass"
