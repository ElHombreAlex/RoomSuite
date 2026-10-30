#!/bin/sh
# Run with the RoomSuite service stopped, and the same data environment as the service.
set -eu
umask 077

if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Usage: backup-roomsuite.sh /path/to/separate/backup-directory' >&2
  exit 2
fi
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
clip_dir=${CLIPROOM_DATA:-"$repo_dir/cliproom/data"}
workspace_dir=${ROOMSUITE_DATA:-"$clip_dir/workspace"}
if [ ! -d "$clip_dir" ] || [ ! -d "$workspace_dir" ]; then
  printf '%s\n' 'Data directory not found. Set CLIPROOM_DATA and ROOMSUITE_DATA to the service values.' >&2
  exit 1
fi
clip_dir=$(CDPATH= cd -- "$clip_dir" && pwd -P)
workspace_dir=$(CDPATH= cd -- "$workspace_dir" && pwd -P)
if [ ! -d "$1" ]; then
  printf '%s\n' 'Create the backup destination directory first.' >&2
  exit 1
fi
backup_dir=$(CDPATH= cd -- "$1" && pwd -P)
case "$backup_dir/" in "$clip_dir/"*|"$workspace_dir/"*)
  printf '%s\n' 'The backup destination must be outside both data directories.' >&2; exit 1;;
esac
stamp=$(date -u +%Y%m%dT%H%M%SZ)
clip_archive="$backup_dir/roomsuite-cliproom-$stamp.tar.gz"
workspace_archive="$backup_dir/roomsuite-workspace-$stamp.tar.gz"
if [ -e "$clip_archive" ] || [ -e "$workspace_archive" ]; then
  printf '%s\n' 'A backup with this timestamp already exists. Try again later.' >&2; exit 1
fi
printf 'Backing up Cliproom data to %s\n' "$clip_archive"
tar -C "$clip_dir" -czf "$clip_archive" .
tar -tzf "$clip_archive" > /dev/null
case "$workspace_dir/" in
  "$clip_dir/"*) printf '%s\n' 'Workspace data is included in the Cliproom archive.';;
  *) printf 'Backing up workspace data to %s\n' "$workspace_archive"
     tar -C "$workspace_dir" -czf "$workspace_archive" .
     tar -tzf "$workspace_archive" > /dev/null;;
esac
printf '%s\n' 'Archives verified. Copy them to independent storage and test a restore.'
