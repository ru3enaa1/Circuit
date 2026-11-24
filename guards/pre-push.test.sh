#!/usr/bin/env bash
# Positive controls for guards/hooks/pre-push (R9): real pushes to a throwaway bare
# repository. Each case says whether the push must be published or stopped, checks the
# remote ref afterwards and the reason in the output, so a hook that stops everything, or
# stops for the wrong reason, fails here too.
#
# Usage: bash guards/pre-push.test.sh   (0 when every case passes, 1 otherwise)
set -u

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
work="$tmp/work"
bare="$tmp/remote.git"
cases=0
failures=0

# Built at run time, so this file never holds a secret shape or a private name itself.
repeat() { printf "%${2}s" '' | tr ' ' "$1"; }
SECRET="sk-ant-$(repeat x 24)"
PRIVATE="nombre-$(repeat p 3)-privado"

g() { git -C "$work" "$@"; }

setup() {
  git init -q --bare "$bare"
  git init -q -b main "$work"
  g config user.name test
  g config user.email test@example.invalid
  # Keeps a machine-wide autocrlf from printing a warning for every planted file.
  g config core.autocrlf false
  g config core.hooksPath guards/hooks
  mkdir -p "$work/guards/hooks"
  cp "$here/check-secrets.sh" "$here/check-forbidden-phrases.sh" "$work/guards/"
  cp "$here/hooks/pre-push" "$work/guards/hooks/"
  printf '%s\n' "$PRIVATE" > "$work/forbidden-phrases.local.txt"
  printf 'forbidden-phrases.local.txt\n' > "$work/.gitignore"
  g remote add origin "$bare"
}

# commit <file> <content> [message]
commit() {
  printf '%s\n' "$2" > "$work/$1"
  g add -A
  g commit -q -m "${3:-test: commit}"
}

# expect <published|stopped> <reason or ""> <case name> <remote ref> <push args...>
expect() {
  local want="$1" reason="$2" name="$3" ref="$4" before after out status verdict=ok
  shift 4
  cases=$((cases + 1))
  before="$(git --git-dir="$bare" rev-parse -q --verify "$ref")"
  out="$(g push -q origin "$@" 2>&1)"
  status=$?
  after="$(git --git-dir="$bare" rev-parse -q --verify "$ref")"
  if [ "$want" = published ]; then
    [ "$status" -eq 0 ] && [ "$before" != "$after" ] || verdict="was not published (exit $status)"
  else
    [ "$status" -ne 0 ] && [ "$before" = "$after" ] || verdict="was not stopped (exit $status)"
  fi
  if [ "$verdict" = ok ] && [ -n "$reason" ]; then
    case "$out" in *"$reason"*) ;; *) verdict="stopped without «$reason»" ;; esac
  fi
  case "$out" in *"$SECRET"*) verdict="output repeats the secret" ;; esac
  if [ "$verdict" = ok ]; then
    echo "  ok   $name"
  else
    failures=$((failures + 1))
    echo "  FAIL $name: $verdict"
    printf '%s\n' "$out" | sed 's/^/        /'
  fi
}

# Drops the local commits a stopped push left behind.
rewind() { g reset -q --hard "origin/$1"; }

setup
echo "pre-push hook:"

commit README.md "hola"
expect published "" "a clean first push is published" refs/heads/main main

commit a.txt "$SECRET"
commit a.txt "gone"
expect stopped "anthropic-api-key" "a secret removed in a later commit is still caught" refs/heads/main main
rewind main

commit b.txt "ok" "fix: $PRIVATE"
expect stopped "forbidden phrases found" "a private name in a commit message stops the push" refs/heads/main main
rewind main

commit c.txt "$PRIVATE"
g rm -q c.txt
g commit -q -m "test: remove it"
expect stopped "forbidden phrases found" "a private name added and removed stops the push" refs/heads/main main
rewind main

commit d.txt "$SECRET"
g push -q --no-verify origin main
g rm -q d.txt
g commit -q -m "test: remove the published secret"
expect published "" "a commit already on the remote is not checked again" refs/heads/main main

g switch -q -c feature
commit e.txt "feature"
expect published "" "a new branch checks only its new commits" refs/heads/feature feature

expect published "" "deleting a remote branch is not checked" refs/heads/feature --delete feature

g switch -q main
g switch -q -c other
commit f.txt "$SECRET"
expect stopped "anthropic-api-key" "a secret in a new branch stops the push" refs/heads/other other

# Only the tree check sees this one: the name is already on the remote, not in a new
# commit, but every push would keep publishing it until it is removed.
g switch -q main
commit h.txt "$PRIVATE"
g push -q --no-verify origin main
commit i.txt "clean"
expect stopped "private list, tree" "a private name still in the pushed tree stops the push" refs/heads/main main
rewind main

# Git skips the hook when nothing would be published, so this case needs a new commit.
commit g.txt "more"
mv "$work/forbidden-phrases.local.txt" "$tmp/list.bak"
expect stopped "missing forbidden-phrases.local.txt" "a missing private list stops the push" refs/heads/main main
mv "$tmp/list.bak" "$work/forbidden-phrases.local.txt"

echo "$cases case(s), $failures failure(s)"
[ "$failures" -eq 0 ]
