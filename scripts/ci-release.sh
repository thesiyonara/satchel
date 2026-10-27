#!/usr/bin/env bash
# Publish CI packages for a version tag. Run by .github/workflows/desktop.yml with the packages in ./artifacts.
#
# No release for the tag yet: compute checksums and open a draft release for a maintainer to review.
# Release already there (a maintainer published it locally, or an earlier run opened the draft): add
# only the packages it lacks and extend its checksum file. Published assets are never replaced, so a
# tag always keeps the bytes users first downloaded.
set -euo pipefail
tag="${1:?tag}"; repo="${2:?owner/repo}"
version="${tag#v}"
package_version="$(node -p "require('./package.json').version")"
if [ "$version" != "$package_version" ]; then echo "Tag $tag does not match package.json version $package_version"; exit 1; fi
sums="SHA256SUMS-$version.txt"
cd artifacts
ls -l

if ! gh release view "$tag" --repo "$repo" --json name >/dev/null 2>&1; then
  sha256sum Sync-it-"$version"-* > "$sums"
  cat "$sums"
  gh release create "$tag" ./* --draft --title "Sync it $version" --generate-notes --repo "$repo"
  exit 0
fi

existing="$(gh release view "$tag" --repo "$repo" --json assets --jq '.assets[].name')"
new=()
for file in Sync-it-"$version"-*; do
  if grep -qxF "$file" <<< "$existing"; then echo "Keeping the published $file"; else new+=("$file"); fi
done
if [ "${#new[@]}" -eq 0 ]; then echo "The release already has every package from this run."; exit 0; fi

mkdir -p published
if grep -qxF "$sums" <<< "$existing"; then gh release download "$tag" --repo "$repo" --pattern "$sums" --dir published; else : > "published/$sums"; fi
{ cat "published/$sums"; sha256sum "${new[@]}"; } | sort -u -k2 > "$sums"
cat "$sums"
gh release upload "$tag" "${new[@]}" --repo "$repo"
gh release upload "$tag" "$sums" --repo "$repo" --clobber
echo "Added ${new[*]} to $tag and extended $sums."
