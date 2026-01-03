# Python imports
import hashlib
import json
import os
import shutil
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

# Django imports
from django.conf import settings
from django.utils import timezone
from django.template.defaultfilters import slugify


def _now_iso():
    return timezone.now().isoformat()


def get_media_library_root(workspace_id, project_id):
    base_dir = getattr(settings, "MEDIA_LIBRARY_ROOT", None)
    if not base_dir:
        base_dir = os.path.join(settings.BASE_DIR, "media-library")
    return Path(base_dir) / "workspaces" / str(workspace_id) / "projects" / str(project_id) / "media-library"


@contextmanager
def manifest_lock(lock_path, timeout=5.0):
    start = time.time()
    lock_path = Path(lock_path)
    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
            os.write(fd, str(os.getpid()).encode())
            break
        except FileExistsError:
            if time.time() - start > timeout:
                raise TimeoutError(f"Timed out waiting for manifest lock: {lock_path}")
            time.sleep(0.05)
    try:
        yield
    finally:
        try:
            os.close(fd)
        finally:
            if lock_path.exists():
                lock_path.unlink(missing_ok=True)


def _atomic_write_json(path, data):
    path = Path(path)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=True, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp_path, path)
    try:
        dir_flag = getattr(os, "O_DIRECTORY", 0)
        dir_fd = os.open(str(path.parent), dir_flag)
    except OSError:
        return
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def _bump_manifest(data, created=False):
    now = _now_iso()
    if created:
        data["created_at"] = now
        data["revision"] = 1
    else:
        data["revision"] = int(data.get("revision", 0)) + 1
    data["updated_at"] = now
    return data


def read_manifest(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_manifest(path, data, created=False):
    _bump_manifest(data, created=created)
    _atomic_write_json(path, data)


def _root_manifest_template():
    now = _now_iso()
    return {
        "schema_version": "1.0",
        "id": "root",
        "type": "root",
        "title": "Media Library",
        "created_at": now,
        "updated_at": now,
        "revision": 1,
        "folders": [],
        "files": [],
        "files_index": {},
        "shares_index": {},
        "stats": {"file_count": 0, "folder_count": 0, "total_bytes": 0},
    }


def ensure_root_manifest(workspace_id, project_id):
    root_dir = get_media_library_root(workspace_id, project_id)
    root_manifest_path = root_dir / "manifest.json"
    folders_dir = root_dir / "folders"
    files_dir = root_dir / "files"
    folders_dir.mkdir(parents=True, exist_ok=True)
    files_dir.mkdir(parents=True, exist_ok=True)

    if not root_manifest_path.exists():
        manifest = _root_manifest_template()
        _atomic_write_json(root_manifest_path, manifest)

    return root_dir, root_manifest_path


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _slug_tag(name):
    slug = slugify(name or "") or (name or "").strip().replace(" ", "-").lower()
    return slug


def get_file_manifest_path(root_dir, file_id):
    root_manifest_path = Path(root_dir) / "manifest.json"
    if not root_manifest_path.exists():
        return None
    root_manifest = read_manifest(root_manifest_path)
    rel_path = root_manifest.get("files_index", {}).get(file_id)
    if not rel_path:
        return None
    return Path(root_dir) / rel_path / "manifest.json"


def load_file_manifest(root_dir, file_id):
    manifest_path = get_file_manifest_path(root_dir, file_id)
    if not manifest_path or not manifest_path.exists():
        return None, None
    return manifest_path, read_manifest(manifest_path)


def _collect_folder_file_ids(folder_manifest):
    return [item.get("id") for item in folder_manifest.get("files", []) if item.get("id")]


def list_all_file_ids(root_manifest, root_dir):
    file_ids = []
    file_ids.extend([item.get("id") for item in root_manifest.get("files", []) if item.get("id")])
    for folder in root_manifest.get("folders", []):
        folder_id = folder.get("id")
        if not folder_id:
            continue
        folder_manifest_path = Path(root_dir) / "folders" / folder_id / "manifest.json"
        if not folder_manifest_path.exists():
            continue
        folder_manifest = read_manifest(folder_manifest_path)
        file_ids.extend(_collect_folder_file_ids(folder_manifest))
    return list(dict.fromkeys(file_ids))


def list_file_manifests(root_dir, filter_folder_id=None, search=None, tag_ids=None, media_kind=None, status_filter=None):
    root_manifest_path = Path(root_dir) / "manifest.json"
    if not root_manifest_path.exists():
        return []
    root_manifest = read_manifest(root_manifest_path)

    file_ids = []
    if filter_folder_id:
        folder_manifest_path = Path(root_dir) / "folders" / filter_folder_id / "manifest.json"
        if folder_manifest_path.exists():
            folder_manifest = read_manifest(folder_manifest_path)
            file_ids = _collect_folder_file_ids(folder_manifest)
    else:
        file_ids = list_all_file_ids(root_manifest, root_dir)

    results = []
    for file_id in file_ids:
        manifest_path = get_file_manifest_path(root_dir, file_id)
        if not manifest_path or not manifest_path.exists():
            continue
        manifest = read_manifest(manifest_path)
        if search:
            haystack = " ".join(
                [
                    manifest.get("title", ""),
                    manifest.get("original", {}).get("filename", ""),
                    manifest.get("path", ""),
                ]
            ).lower()
            if search.lower() not in haystack:
                continue
        if tag_ids:
            tags = [tag.get("slug") for tag in manifest.get("tags", [])]
            if not any(tag_id in tags for tag_id in tag_ids):
                continue
        if media_kind and manifest.get("kind") != media_kind.lower():
            continue
        if status_filter and manifest.get("status") != status_filter:
            continue
        results.append(manifest)
    results.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return results


def list_tags(root_dir):
    root_manifest_path = Path(root_dir) / "manifest.json"
    if not root_manifest_path.exists():
        return []
    root_manifest = read_manifest(root_manifest_path)
    file_ids = list_all_file_ids(root_manifest, root_dir)
    tag_counts = {}
    for file_id in file_ids:
        manifest_path = get_file_manifest_path(root_dir, file_id)
        if not manifest_path or not manifest_path.exists():
            continue
        manifest = read_manifest(manifest_path)
        for tag in manifest.get("tags", []):
            slug = tag.get("slug")
            name = tag.get("name")
            if not slug:
                slug = _slug_tag(name)
            if not slug:
                continue
            tag_counts.setdefault(slug, {"id": slug, "name": name or slug, "slug": slug, "asset_count": 0})
            tag_counts[slug]["asset_count"] += 1
    return sorted(tag_counts.values(), key=lambda item: item.get("name", ""))


def list_collections(root_dir):
    root_manifest_path = Path(root_dir) / "manifest.json"
    if not root_manifest_path.exists():
        return []
    root_manifest = read_manifest(root_manifest_path)
    collections = []
    for folder in root_manifest.get("folders", []):
        folder_id = folder.get("id")
        if not folder_id:
            continue
        folder_manifest_path = Path(root_dir) / "folders" / folder_id / "manifest.json"
        asset_count = 0
        if folder_manifest_path.exists():
            folder_manifest = read_manifest(folder_manifest_path)
            asset_count = len(_collect_folder_file_ids(folder_manifest))
        collections.append(
            {
                "id": folder_id,
                "name": folder.get("name"),
                "slug": folder.get("slug"),
                "description": folder.get("description", ""),
                "parent": folder.get("parent_id"),
                "asset_count": asset_count,
                "created_at": folder.get("created_at"),
                "updated_at": folder.get("updated_at"),
            }
        )
    return sorted(collections, key=lambda item: item.get("name", ""))


def create_collection(root_dir, name, description="", parent_id=None):
    root_manifest_path = Path(root_dir) / "manifest.json"
    folder_id = f"f_{uuid4().hex}"
    slug = _slug_tag(name)
    folder_dir = Path(root_dir) / "folders" / folder_id
    folder_dir.mkdir(parents=True, exist_ok=True)
    (folder_dir / "folders").mkdir(exist_ok=True)
    (folder_dir / "files").mkdir(exist_ok=True)

    folder_manifest = {
        "schema_version": "1.0",
        "id": folder_id,
        "type": "folder",
        "name": name,
        "slug": slug,
        "parent_id": parent_id,
        "path": f"/{name}",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "revision": 1,
        "folders": [],
        "files": [],
        "description": description,
    }
    _atomic_write_json(folder_dir / "manifest.json", folder_manifest)

    with manifest_lock(root_manifest_path.with_suffix(".lock")):
        root_manifest = read_manifest(root_manifest_path)
        root_manifest["folders"].append(
            {
                "id": folder_id,
                "name": name,
                "slug": slug,
                "parent_id": parent_id,
                "path": f"/{name}",
                "description": description or "",
                "created_at": folder_manifest["created_at"],
                "updated_at": folder_manifest["updated_at"],
            }
        )
        root_manifest["stats"]["folder_count"] = len(root_manifest["folders"])
        write_manifest(root_manifest_path, root_manifest)

    return folder_manifest


def update_collection(root_dir, collection_id, name=None, description=None, parent_id=None):
    folder_dir = Path(root_dir) / "folders" / collection_id
    manifest_path = folder_dir / "manifest.json"
    if not manifest_path.exists():
        return None
    with manifest_lock(manifest_path.with_suffix(".lock")):
        folder_manifest = read_manifest(manifest_path)
        if name is not None:
            folder_manifest["name"] = name
            folder_manifest["slug"] = _slug_tag(name)
            folder_manifest["path"] = f"/{name}"
        if description is not None:
            folder_manifest["description"] = description
        if parent_id is not None:
            folder_manifest["parent_id"] = parent_id
        write_manifest(manifest_path, folder_manifest)

    root_manifest_path = Path(root_dir) / "manifest.json"
    with manifest_lock(root_manifest_path.with_suffix(".lock")):
        root_manifest = read_manifest(root_manifest_path)
        for folder in root_manifest.get("folders", []):
            if folder.get("id") == collection_id:
                if name is not None:
                    folder["name"] = name
                    folder["slug"] = _slug_tag(name)
                    folder["path"] = f"/{name}"
                if description is not None:
                    folder["description"] = description
                if parent_id is not None:
                    folder["parent_id"] = parent_id
                folder["updated_at"] = folder_manifest["updated_at"]
        write_manifest(root_manifest_path, root_manifest)

    return folder_manifest


def delete_collection(root_dir, collection_id):
    folder_dir = Path(root_dir) / "folders" / collection_id
    manifest_path = folder_dir / "manifest.json"
    if not manifest_path.exists():
        return False
    folder_manifest = read_manifest(manifest_path)
    if folder_manifest.get("files"):
        return False

    for path in folder_dir.glob("*"):
        if path.is_dir():
            for child in path.rglob("*"):
                if child.is_file():
                    child.unlink()
            path.rmdir()
        elif path.is_file():
            path.unlink()
    folder_dir.rmdir()

    root_manifest_path = Path(root_dir) / "manifest.json"
    with manifest_lock(root_manifest_path.with_suffix(".lock")):
        root_manifest = read_manifest(root_manifest_path)
        root_manifest["folders"] = [item for item in root_manifest.get("folders", []) if item.get("id") != collection_id]
        root_manifest["stats"]["folder_count"] = len(root_manifest["folders"])
        write_manifest(root_manifest_path, root_manifest)
    return True


def create_file_from_upload(
    root_dir,
    file_obj,
    title=None,
    description="",
    tags=None,
    collection_ids=None,
    mime_type_override=None,
):
    file_id = f"m_{uuid4().hex}"
    original_name = file_obj.name
    mime_type = mime_type_override or getattr(file_obj, "content_type", "") or "application/octet-stream"
    tags = tags or []
    collection_ids = collection_ids or []
    parent_id = collection_ids[0] if collection_ids else "root"

    if parent_id != "root":
        file_dir = Path(root_dir) / "folders" / parent_id / "files" / file_id
    else:
        file_dir = Path(root_dir) / "files" / file_id
    (file_dir / "original").mkdir(parents=True, exist_ok=True)
    (file_dir / "renditions").mkdir(exist_ok=True)
    (file_dir / "thumbs").mkdir(exist_ok=True)

    original_path = file_dir / "original" / original_name
    with open(original_path, "wb") as handle:
        for chunk in file_obj.chunks():
            handle.write(chunk)
    size = original_path.stat().st_size

    manifest = {
        "schema_version": "1.0",
        "id": file_id,
        "type": "file",
        "parent_id": parent_id,
        "path": f"/{original_name}",
        "title": title or os.path.splitext(original_name)[0],
        "description": description or "",
        "original": {
            "filename": original_name,
            "relative_path": f"original/{original_name}",
            "bytes": size,
            "mime_type": mime_type,
            "sha256": _sha256_file(original_path),
        },
        "kind": mime_type.split("/")[0] if "/" in mime_type else "other",
        "status": "PROCESSING",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "revision": 1,
        "metadata": {"duration_sec": None, "width": None, "height": None, "page_count": None},
        "tags": [{"name": tag, "slug": _slug_tag(tag)} for tag in tags],
        "collections": collection_ids,
        "renditions": [],
        "thumbnails": [],
        "preview": {"preferred": None, "fallback": f"original/{original_name}"},
        "errors": [],
    }
    _atomic_write_json(file_dir / "manifest.json", manifest)

    root_manifest_path = Path(root_dir) / "manifest.json"
    with manifest_lock(root_manifest_path.with_suffix(".lock")):
        root_manifest = read_manifest(root_manifest_path)
        root_manifest.setdefault("files_index", {})[file_id] = str(file_dir.relative_to(root_dir))
        if parent_id == "root":
            root_manifest.setdefault("files", []).append({"id": file_id, "name": original_name, "path": f"/{original_name}"})
        root_manifest["stats"]["file_count"] = len(root_manifest.get("files_index", {}))
        root_manifest["stats"]["total_bytes"] = (
            int(root_manifest["stats"].get("total_bytes", 0)) + int(size)
        )
        write_manifest(root_manifest_path, root_manifest)

    for collection_id in collection_ids:
        folder_manifest_path = Path(root_dir) / "folders" / collection_id / "manifest.json"
        if not folder_manifest_path.exists():
            continue
        with manifest_lock(folder_manifest_path.with_suffix(".lock")):
            folder_manifest = read_manifest(folder_manifest_path)
            folder_manifest.setdefault("files", [])
            if not any(item.get("id") == file_id for item in folder_manifest["files"]):
                folder_manifest["files"].append(
                    {"id": file_id, "name": original_name, "path": f"/{original_name}"}
                )
            write_manifest(folder_manifest_path, folder_manifest)

    return manifest


def update_file_manifest(root_dir, file_id, updates):
    manifest_path = get_file_manifest_path(root_dir, file_id)
    if not manifest_path or not manifest_path.exists():
        return None
    with manifest_lock(manifest_path.with_suffix(".lock")):
        manifest = read_manifest(manifest_path)
        manifest.update(updates)
        write_manifest(manifest_path, manifest)
    return manifest


def update_file_tags_collections(root_dir, file_id, tags=None, collections=None):
    manifest_path = get_file_manifest_path(root_dir, file_id)
    if not manifest_path or not manifest_path.exists():
        return None
    manifest = read_manifest(manifest_path)
    current_collections = list(manifest.get("collections", []))
    next_collections = current_collections
    if collections is not None:
        next_collections = collections

    current_parent_id = manifest.get("parent_id") or "root"
    next_parent_id = next_collections[0] if next_collections else "root"

    if tags is not None:
        manifest["tags"] = [{"name": tag, "slug": _slug_tag(tag)} for tag in tags]
    if collections is not None:
        manifest["collections"] = next_collections
    manifest["parent_id"] = next_parent_id

    original_name = manifest.get("original", {}).get("filename") or manifest.get("title") or file_id

    if next_parent_id != current_parent_id:
        current_dir = manifest_path.parent
        if next_parent_id == "root":
            target_dir = Path(root_dir) / "files" / file_id
        else:
            target_dir = Path(root_dir) / "folders" / next_parent_id / "files" / file_id
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(current_dir), str(target_dir))
        manifest_path = target_dir / "manifest.json"

        root_manifest_path = Path(root_dir) / "manifest.json"
        with manifest_lock(root_manifest_path.with_suffix(".lock")):
            root_manifest = read_manifest(root_manifest_path)
            root_manifest.setdefault("files_index", {})[file_id] = str(target_dir.relative_to(root_dir))
            if next_parent_id == "root":
                root_manifest.setdefault("files", [])
                if not any(item.get("id") == file_id for item in root_manifest["files"]):
                    root_manifest["files"].append(
                        {"id": file_id, "name": original_name, "path": f"/{original_name}"}
                    )
            else:
                root_manifest["files"] = [
                    item for item in root_manifest.get("files", []) if item.get("id") != file_id
                ]
            write_manifest(root_manifest_path, root_manifest)

    removed_collections = set(current_collections) - set(next_collections)
    added_collections = set(next_collections) - set(current_collections)

    for collection_id in removed_collections:
        folder_manifest_path = Path(root_dir) / "folders" / collection_id / "manifest.json"
        if not folder_manifest_path.exists():
            continue
        with manifest_lock(folder_manifest_path.with_suffix(".lock")):
            folder_manifest = read_manifest(folder_manifest_path)
            folder_manifest["files"] = [
                item for item in folder_manifest.get("files", []) if item.get("id") != file_id
            ]
            write_manifest(folder_manifest_path, folder_manifest)

    for collection_id in added_collections:
        folder_manifest_path = Path(root_dir) / "folders" / collection_id / "manifest.json"
        if not folder_manifest_path.exists():
            continue
        with manifest_lock(folder_manifest_path.with_suffix(".lock")):
            folder_manifest = read_manifest(folder_manifest_path)
            folder_manifest.setdefault("files", [])
            if not any(item.get("id") == file_id for item in folder_manifest["files"]):
                folder_manifest["files"].append(
                    {"id": file_id, "name": original_name, "path": f"/{original_name}"}
                )
            write_manifest(folder_manifest_path, folder_manifest)

    with manifest_lock(manifest_path.with_suffix(".lock")):
        write_manifest(manifest_path, manifest)
    return manifest


def delete_file(root_dir, file_id):
    manifest_path = get_file_manifest_path(root_dir, file_id)
    if not manifest_path or not manifest_path.exists():
        return False
    manifest = read_manifest(manifest_path)
    file_dir = manifest_path.parent

    root_manifest_path = Path(root_dir) / "manifest.json"
    with manifest_lock(root_manifest_path.with_suffix(".lock")):
        root_manifest = read_manifest(root_manifest_path)
        root_manifest.get("files_index", {}).pop(file_id, None)
        root_manifest["files"] = [item for item in root_manifest.get("files", []) if item.get("id") != file_id]
        root_manifest["stats"]["file_count"] = len(root_manifest.get("files_index", {}))
        total_bytes = int(root_manifest["stats"].get("total_bytes", 0))
        removed_bytes = int(manifest.get("original", {}).get("bytes", 0) or 0)
        root_manifest["stats"]["total_bytes"] = max(total_bytes - removed_bytes, 0)
        write_manifest(root_manifest_path, root_manifest)

    collection_ids = manifest.get("collections", []) or []
    for collection_id in collection_ids:
        folder_manifest_path = Path(root_dir) / "folders" / collection_id / "manifest.json"
        if not folder_manifest_path.exists():
            continue
        with manifest_lock(folder_manifest_path.with_suffix(".lock")):
            folder_manifest = read_manifest(folder_manifest_path)
            folder_manifest["files"] = [
                item for item in folder_manifest.get("files", []) if item.get("id") != file_id
            ]
            write_manifest(folder_manifest_path, folder_manifest)

    for path in file_dir.rglob("*"):
        if path.is_file():
            path.unlink()
    for path in sorted(file_dir.rglob("*"), reverse=True):
        if path.is_dir():
            path.rmdir()
    file_dir.rmdir()
    return True


def create_share(root_dir, file_id, expires_at=None):
    manifest_path = get_file_manifest_path(root_dir, file_id)
    if not manifest_path or not manifest_path.exists():
        return None, None
    token = uuid4()
    share_entry = {
        "id": f"s_{uuid4().hex}",
        "token": str(token),
        "expires_at": expires_at,
        "revoked_at": None,
        "created_at": _now_iso(),
    }

    with manifest_lock(manifest_path.with_suffix(".lock")):
        manifest = read_manifest(manifest_path)
        manifest.setdefault("shares", []).append(share_entry)
        write_manifest(manifest_path, manifest)

    root_manifest_path = Path(root_dir) / "manifest.json"
    with manifest_lock(root_manifest_path.with_suffix(".lock")):
        root_manifest = read_manifest(root_manifest_path)
        root_manifest.setdefault("shares_index", {})[share_entry["token"]] = {
            "file_id": file_id,
            "expires_at": expires_at,
            "revoked_at": None,
        }
        write_manifest(root_manifest_path, root_manifest)

    return share_entry, str(token)


def revoke_share(root_dir, file_id, share_id):
    manifest_path = get_file_manifest_path(root_dir, file_id)
    if not manifest_path or not manifest_path.exists():
        return False
    revoked_at = _now_iso()
    token = None

    with manifest_lock(manifest_path.with_suffix(".lock")):
        manifest = read_manifest(manifest_path)
        for share in manifest.get("shares", []):
            if share.get("id") == share_id:
                share["revoked_at"] = revoked_at
                token = share.get("token")
        write_manifest(manifest_path, manifest)

    if token:
        root_manifest_path = Path(root_dir) / "manifest.json"
        with manifest_lock(root_manifest_path.with_suffix(".lock")):
            root_manifest = read_manifest(root_manifest_path)
            if token in root_manifest.get("shares_index", {}):
                root_manifest["shares_index"][token]["revoked_at"] = revoked_at
            write_manifest(root_manifest_path, root_manifest)
    return True


def resolve_share(root_dir, token):
    root_manifest_path = Path(root_dir) / "manifest.json"
    if not root_manifest_path.exists():
        return None
    root_manifest = read_manifest(root_manifest_path)
    return root_manifest.get("shares_index", {}).get(token)
