#!/usr/bin/env bash
# One-command release: export a clean snapshot to the public repository, tag it, create the GitHub release and publish to npm.
# Run by the user on their own machine. Claude does not run this. See docs/process/release.md.
set -euo pipefail

DEFAULT_URL="https://github.com/skillnib/skillnib.git"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_CMD="${RELEASE_VERIFY_CMD:-npm run check && npm test && npm run release:check}"

usage() {
  cat <<'U'
usage: tools/release/release.sh <version> [--dry-run] [--yes] [--public-url URL] [--branch NAME]
  <version>        MAJOR.MINOR.PATCH, optional -prerelease (prereleases publish to the npm tag "next")
  --dry-run        run preflight, export, guard and verification; print the outward steps without running them
  --yes            do not wait for the word "release"
  --public-url     public repository (default https://github.com/skillnib/skillnib.git)
  --branch         release branch of the private repository (default main)
U
}
die() { echo "release: $*" >&2; exit "${2:-1}"; }

VERSION="" DRY=0 YES=0 URL="$DEFAULT_URL" BRANCH=main
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --dry-run) DRY=1 ;;
    --yes) YES=1 ;;
    --public-url) [ $# -ge 2 ] || die "--public-url needs a value" 2; URL="$2"; shift ;;
    --branch) [ $# -ge 2 ] || die "--branch needs a value" 2; BRANCH="$2"; shift ;;
    -*) usage >&2; die "unknown flag $1" 2 ;;
    *) [ -z "$VERSION" ] || die "more than one version given" 2; VERSION="$1" ;;
  esac
  shift
done
[ -n "$VERSION" ] || { usage >&2; die "missing version" 2; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "version \"$VERSION\" is not MAJOR.MINOR.PATCH[-prerelease]" 2
TAG="v$VERSION"

# --- preflight --------------------------------------------------------------------------------
for tool in git npm node; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || die "Node 22 or newer is required"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"
cd "$ROOT"
[ -z "$(git status --porcelain)" ] || die "working tree is not clean"
[ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || die "current branch is not $BRANCH"
git fetch -q origin "$BRANCH" || die "cannot fetch origin/$BRANCH"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] || die "$BRANCH differs from origin/$BRANCH (push or pull first)"
COMMIT="$(git rev-parse HEAD)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/skillnib-release.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
EXPORT="$WORK/export"; mkdir -p "$EXPORT"
G="$WORK/git"; git init -q "$G"

# Public repository state: its branch and its tags.
PUBLIC_MAIN=""
if git ls-remote --exit-code --heads "$URL" main >/dev/null 2>&1; then
  git -C "$G" fetch -q "$URL" main:refs/remotes/public/main
  PUBLIC_MAIN="$(git -C "$G" rev-parse refs/remotes/public/main)"
fi
TAGS="$(git ls-remote --tags --refs "$URL" 'v*' 2>/dev/null | sed 's|.*refs/tags/v||' || true)"
TAG_EXISTS=0; echo "$TAGS" | grep -qx "$VERSION" && TAG_EXISTS=1
if [ "$TAG_EXISTS" = 0 ]; then
  LATEST="$(printf '%s\n' "$TAGS" | { grep -v '^$' || true; } | node -e '
    const v=s=>{const[m,p]=s.split("-");return[...m.split(".").map(Number),p]};
    const cmp=(a,b)=>{for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]-b[i];return a[3]===b[3]?0:!a[3]?1:!b[3]?-1:a[3]<b[3]?-1:1};
    const l=require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean).sort((x,y)=>cmp(v(x),v(y)));console.log(l.at(-1)??"")')"
  if [ -n "$LATEST" ]; then
    node -e '
      const v=s=>{const[m,p]=s.split("-");return[...m.split(".").map(Number),p]};
      const a=v(process.argv[1]),b=v(process.argv[2]);let c=0;for(let i=0;i<3&&!c;i++)c=a[i]-b[i];
      if(!c)c=a[3]===b[3]?0:!a[3]?1:!b[3]?-1:a[3]<b[3]?-1:1;process.exit(c>0?0:1)' "$VERSION" "$LATEST" || die "version $VERSION is not newer than the latest public tag v$LATEST" 2
  fi
fi

# --- export -----------------------------------------------------------------------------------
EXC=()
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in :\(glob\)*) EXC+=(":(exclude,glob)${line#:(glob)}") ;; *) EXC+=(":(exclude)$line") ;; esac
done < "$HERE/export-ignore"
git archive "$COMMIT" -- . "${EXC[@]}" | tar -x -C "$EXPORT"
[ -f "$EXPORT/package.json" ] || die "the export has no package.json"
node -e 'const fs=require("fs"),f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/"version": *"[^"]*"/,"\"version\": \""+process.argv[2]+"\""))' "$EXPORT/package.json" "$VERSION"
NAME="$(node -p 'require(process.argv[1]).name' "$EXPORT/package.json")"

# --- private-material guard -------------------------------------------------------------------
GUARD=0
while IFS= read -r f; do
  while IFS= read -r pat; do
    case "$pat" in ''|'#'*) continue ;; esac
    # shellcheck disable=SC2254
    case "$f" in $pat) echo "release: private path in export: $f (matches $pat)" >&2; GUARD=1 ;; esac
  done < "$HERE/private-paths"
done < <(cd "$EXPORT" && find . -type f -not -path './node_modules/*' | sed 's|^\./||')
TOKEN_RE='(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|npm_[A-Za-z0-9]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
HITS="$(cd "$EXPORT" && grep -rIlE "$TOKEN_RE" . 2>/dev/null || true)"
if [ -n "$HITS" ]; then echo "release: token-looking string in export: $HITS" >&2; GUARD=1; fi
[ "$GUARD" = 0 ] || die "private-material guard failed; nothing was released"

# --- verify in the export ---------------------------------------------------------------------
echo "release: verifying the export of $COMMIT as $NAME@$VERSION"
( cd "$EXPORT" && bash -c "$VERIFY_CMD" ) || die "verification failed in the export; nothing was released"
PACK="$WORK/pack"; mkdir -p "$PACK"
( cd "$EXPORT" && npm pack --silent --pack-destination "$PACK" >/dev/null )
TGZ="$(ls "$PACK"/*.tgz | head -1)"
SUM="$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$TGZ")"
FILES="$(tar -tzf "$TGZ" | wc -l | tr -d ' ')"

# --- snapshot commit --------------------------------------------------------------------------
export GIT_INDEX_FILE="$WORK/index"
git -C "$G" --work-tree="$EXPORT" add -A
TREE="$(git -C "$G" --work-tree="$EXPORT" write-tree)"
unset GIT_INDEX_FILE
PARENT=(); [ -n "$PUBLIC_MAIN" ] && PARENT=(-p "$PUBLIC_MAIN")
RESUME=0
if [ "$TAG_EXISTS" = 1 ]; then
  git -C "$G" fetch -q "$URL" "refs/tags/$TAG:refs/tags/$TAG"
  [ "$(git -C "$G" rev-parse "$TAG^{tree}")" = "$TREE" ] || die "tag $TAG already exists in the public repository with different content"
  RESUME=1; SNAP="$(git -C "$G" rev-parse "$TAG^{commit}")"
else
  SNAP="$(git -C "$G" commit-tree "$TREE" ${PARENT[@]+"${PARENT[@]}"} -m "Release $TAG")"
fi

# npm name check (first release only)
if [ -z "$TAGS" ] && npm view "$NAME" name >/dev/null 2>&1; then die "the npm name \"$NAME\" is already taken; choose another name in package.json"; fi

NPM_TAG=(); case "$VERSION" in *-*) NPM_TAG=(--tag next) ;; esac
SLUG="$(printf '%s' "$URL" | sed -nE 's#.*github\.com[:/]([^/]+/[^/]+)$#\1#p' | sed 's/\.git$//')"
GH_ARGS=(--repo "${SLUG:-$URL}")
GH_CMD=(gh release create "$TAG" "$TGZ" --title "$TAG" --notes "SHA-256 of $(basename "$TGZ"): $SUM" "${GH_ARGS[@]}")
[ "${#NPM_TAG[@]}" -gt 0 ] && GH_CMD+=(--prerelease)
NPM_CMD=(npm publish "$TGZ" --access public ${NPM_TAG[@]+"${NPM_TAG[@]}"})

echo
echo "release plan"
echo "  version      $VERSION ($TAG)"
echo "  source       $COMMIT ($BRANCH)"
echo "  snapshot     $SNAP$([ "$RESUME" = 1 ] && echo ' (already in the public repository)')"
echo "  files        $FILES in $(basename "$TGZ")"
echo "  sha256       $SUM"
echo "  public repo  $URL"
echo "  npm          $NAME@$VERSION${NPM_TAG[*]:+ (tag next)}"

if [ "$DRY" = 1 ]; then
  echo "dry run: not pushing, not creating the GitHub release, not publishing. The outward steps would be:"
  [ "$RESUME" = 1 ] || echo "  git push $URL $SNAP:refs/heads/main $TAG"
  command -v gh >/dev/null && echo "  ${GH_CMD[*]}" || echo "  (gh not installed) ${GH_CMD[*]}"
  echo "  ${NPM_CMD[*]}"
  exit 0
fi

if [ "$YES" = 0 ]; then
  printf 'Type "release" to continue: '
  read -r answer || answer=""
  [ "$answer" = "release" ] || die "cancelled; nothing was released"
fi

# --- outward steps, each skipped when already done --------------------------------------------
if [ "$RESUME" = 0 ]; then
  git -C "$G" tag -a "$TAG" -m "$TAG" "$SNAP"
  git -C "$G" push -q "$URL" "$SNAP:refs/heads/main" "refs/tags/$TAG:refs/tags/$TAG" || die "push to $URL failed"
  echo "release: pushed $TAG to $URL"
else
  echo "release: $TAG is already in the public repository"
fi

if command -v gh >/dev/null; then
  if gh release view "$TAG" "${GH_ARGS[@]}" >/dev/null 2>&1; then echo "release: GitHub release $TAG already exists"
  else "${GH_CMD[@]}" || die "GitHub release failed; rerun the same command to retry"; echo "release: GitHub release $TAG created"; fi
else
  echo "release: gh is not installed. Create the release yourself with:"; echo "  ${GH_CMD[*]}"
fi

if [ "$(npm view "$NAME@$VERSION" version 2>/dev/null || true)" = "$VERSION" ]; then echo "release: $NAME@$VERSION is already on npm"
else "${NPM_CMD[@]}" || die "npm publish failed; rerun the same command to retry"; echo "release: published $NAME@$VERSION"; fi
echo "release: done"
