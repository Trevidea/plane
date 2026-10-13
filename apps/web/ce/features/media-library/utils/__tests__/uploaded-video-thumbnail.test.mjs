import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import test from "node:test";
import { API_BASE_URL } from "@plane/constants";
import { buildUploadedVideoCardPlaylist } from "../uploaded-video-card.ts";

// Resolve the app's extensionless TypeScript imports in Node's test runner.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !extname(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
let mapArtifactsToMediaItems;
let buildMediaThumbnailLookup;
let resolveTagRowArtifactThumbnail;
let buildCardPlaylists;
try {
  ({ mapArtifactsToMediaItems } = await import("../media-items.ts"));
  ({ buildMediaThumbnailLookup, resolveTagRowArtifactThumbnail } = await import(
    "../../../../../core/components/issues/issue-detail/sg-event-detail-page/media-thumbnail-lookup.ts"
  ));
  ({ buildCardPlaylists } = await import(
    "../../../../../core/components/issues/issue-detail/sg-event-detail-page/create-card-model.ts"
  ));
} finally {
  hooks.deregister();
}

const context = { workspaceSlug: "football", projectId: "project-1", packageId: "package-1" };
const videoId = "quater_not_change-1787204867821-0";
const thumbnailId = `${videoId}-thumbnail`;
const sourceUrl = "https://media.example/upload/hls/master.m3u8";
const posterUrl = "https://media.example/upload/poster.webp?token=AbC%2F123&expires=123456";
const localThumbnailPath = `projects/project-1/packages/package-1/artifacts/${thumbnailId}.webp`;
const fileUrl = (id) =>
  `${API_BASE_URL.replace(/\/$/, "")}/api/workspaces/football/projects/project-1/media-library/packages/package-1/artifacts/${id}/file/`;

const artifacts = (thumbnailPath) => [
  {
    name: videoId,
    title: "Quarter video",
    format: "m3u8",
    action: "play_hls",
    path: sourceUrl,
    link: null,
    created_at: "2026-10-12T00:00:00Z",
    updated_at: "2026-10-12T00:00:00Z",
  },
  {
    name: thumbnailId,
    title: "Quarter video thumbnail",
    format: "thumbnail",
    action: "preview",
    path: thumbnailPath,
    link: videoId,
    created_at: "2026-10-12T00:00:00Z",
    updated_at: "2026-10-12T00:00:00Z",
  },
];

const getCardThumbnail = (item) => {
  const playlist = buildUploadedVideoCardPlaylist(item, 15);
  return buildCardPlaylists([playlist], [])[0].clips[0].thumbnail;
};

test("uploaded video poster URLs reach card previews and tag thumbnails unchanged", () => {
  for (const url of [
    posterUrl,
    "http://localhost:1437/api/blobs/media/upload/poster.webp",
    "/sports/api/blobs/media/media-dbce844eeb8a1cc11434d8c17ffc048a62d30397/thumbnails/poster.jpg",
    "/api/blobs/media/upload/thumbnails/poster.jpg",
    "/blobs/media/upload/thumbnails/poster.jpg",
  ]) {
    const manifest = artifacts(url);
    const items = mapArtifactsToMediaItems(manifest, context);
    const video = items.find((item) => item.id === videoId);
    const lookup = buildMediaThumbnailLookup(items, manifest, context);

    assert.equal(getCardThumbnail(video), url);
    assert.equal(lookup.get(thumbnailId), url);
    assert.equal(resolveTagRowArtifactThumbnail({ thumbnailUrl: "", sourceUrl }, lookup, ""), url);
  }
});

test("current video poster metadata takes precedence over a legacy local thumbnail entry", () => {
  for (const key of ["poster_url", "thumbnail"]) {
    const manifest = artifacts(localThumbnailPath);
    const items = mapArtifactsToMediaItems(manifest, {
      ...context,
      metadata: { [videoId]: { transcode_status: "COMPLETED", [key]: posterUrl } },
    });
    const video = items.find((item) => item.id === videoId);
    const lookup = buildMediaThumbnailLookup(items, manifest, context);

    assert.equal(getCardThumbnail(video), posterUrl);
    assert.equal(resolveTagRowArtifactThumbnail({ thumbnailUrl: "", sourceUrl }, lookup, ""), posterUrl);
  }
});

test("local thumbnails continue to use the authenticated artifact file endpoint", () => {
  const manifest = artifacts(localThumbnailPath);
  const items = mapArtifactsToMediaItems(manifest, context);
  const video = items.find((item) => item.id === videoId);
  const lookup = buildMediaThumbnailLookup(items, manifest, context);

  assert.equal(getCardThumbnail(video), fileUrl(thumbnailId));
  assert.equal(lookup.get(thumbnailId), fileUrl(thumbnailId));
  assert.equal(resolveTagRowArtifactThumbnail({ thumbnailUrl: "", sourceUrl }, lookup, ""), fileUrl(thumbnailId));
});

test("external manifest thumbnails resolve directly before media items are available", () => {
  for (const url of [posterUrl, "/sports/api/blobs/media/upload/thumbnails/poster.jpg"]) {
    const lookup = buildMediaThumbnailLookup(undefined, artifacts(url), context);

    assert.equal(lookup.get(thumbnailId), url);
    assert.equal(resolveTagRowArtifactThumbnail({ thumbnailUrl: "", sourceUrl }, lookup, ""), url);
  }
});

test("saved artifact thumbnail references resolve to the current poster URL", () => {
  const manifest = artifacts(posterUrl);
  const items = mapArtifactsToMediaItems(manifest, context);
  const lookup = buildMediaThumbnailLookup(items, manifest, context);

  assert.equal(
    resolveTagRowArtifactThumbnail({ thumbnailUrl: fileUrl(thumbnailId), sourceUrl }, lookup, ""),
    posterUrl
  );
});

test("coach thumbnail proxy references retain their existing resolution", () => {
  const lookup = buildMediaThumbnailLookup([], [], context);

  assert.equal(
    resolveTagRowArtifactThumbnail(
      { thumbnailUrl: "/api/coach/media/proxy?thumbnail=tag-1.jpg", sourceUrl: "" },
      lookup,
      "https://coach.example/"
    ),
    "https://coach.example/blobs/thumbnails/tag-1.jpg"
  );
});
