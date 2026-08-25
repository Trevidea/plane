import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMediaLibraryUploadJobs,
  FALLBACK_MEDIA_LIBRARY_MAX_FILE_SIZE,
  formatFileSize,
  getUploadStatusLabel,
  getVisibleUploadProgress,
  isActiveUploadStatus,
  isTranscodableVideoUpload,
  readMediaLibraryFileSizeLimit,
  resolveArtifactFormat,
  shouldAutoCloseUploadModal,
} from "../media-library-upload-jobs.ts";

const createFile = (name, size, type = "video/mp4") =>
  new File([new Uint8Array(size)], name, {
    type,
    lastModified: 1_785_922_733_582,
  });

test("buildMediaLibraryUploadJobs creates queued background upload jobs", () => {
  const file = createFile("clip-01.mp4", 4);
  const jobs = buildMediaLibraryUploadJobs({
    workspaceSlug: "workspace-a",
    projectId: "project-a",
    files: [file],
    meta: { category: "Game", sport: "Football" },
    workItemId: null,
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].workspaceSlug, "workspace-a");
  assert.equal(jobs[0].projectId, "project-a");
  assert.equal(jobs[0].file, file);
  assert.equal(jobs[0].status, "queued");
  assert.equal(jobs[0].progress, 0);
  assert.equal(jobs[0].meta.category, "Game");
  assert.match(jobs[0].uploadId, /^upload-\d{8}T\d{6}Z-clip-01-mp4-4-1785922733582$/);
});

test("buildMediaLibraryUploadJobs persists multi-file upload batch metadata", () => {
  const jobs = buildMediaLibraryUploadJobs({
    workspaceSlug: "workspace-a",
    projectId: "project-a",
    files: [createFile("clip-01.mov", 4, "video/quicktime"), createFile("clip-02.mov", 4, "video/quicktime")],
    meta: { category: "Practice", location: "Home" },
    batchName: "Morning practice",
  });

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].meta.upload_batch_name, "Morning practice");
  assert.equal(jobs[0].meta.upload_batch_size, 2);
  assert.equal(jobs[1].meta.upload_batch_index, 2);
  assert.equal(jobs[0].batchId, jobs[1].batchId);
});

test("buildMediaLibraryUploadJobs keeps unnamed multi-file uploads separate", () => {
  const jobs = buildMediaLibraryUploadJobs({
    workspaceSlug: "workspace-a",
    projectId: "project-a",
    files: [createFile("clip-01.mov", 4, "video/quicktime"), createFile("clip-02.mov", 4, "video/quicktime")],
    meta: { category: "Practice", location: "Home" },
  });

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].batchId, null);
  assert.equal(jobs[1].batchId, null);
  assert.equal(jobs[0].meta.upload_batch_id, undefined);
  assert.equal(jobs[1].meta.upload_batch_id, undefined);
});

test("upload helpers normalize size limit and display labels", () => {
  assert.equal(FALLBACK_MEDIA_LIBRARY_MAX_FILE_SIZE, 5 * 1024 * 1024 * 1024);
  assert.equal(readMediaLibraryFileSizeLimit("5368709120"), 5 * 1024 * 1024 * 1024);
  assert.equal(readMediaLibraryFileSizeLimit("bad"), null);
  assert.equal(formatFileSize(5 * 1024 * 1024 * 1024), "5GB");
  assert.equal(formatFileSize(194 * 1024 * 1024), "194MB");
});

test("resolveArtifactFormat accepts supported media and rejects unknown formats", () => {
  assert.equal(resolveArtifactFormat("game.mp4"), "mp4");
  assert.equal(resolveArtifactFormat("practice.MOV"), "mov");
  assert.equal(resolveArtifactFormat("clip.m3u8"), "m3u8");
  assert.equal(resolveArtifactFormat("thumbnail.PNG"), "png");
  assert.equal(resolveArtifactFormat("notes.pdf"), "pdf");
  assert.equal(resolveArtifactFormat("archive.zip"), "");
});

test("isTranscodableVideoUpload accepts mp4 and mov uploads", () => {
  assert.equal(isTranscodableVideoUpload(createFile("clip.mp4", 4, "video/mp4")), true);
  assert.equal(isTranscodableVideoUpload(createFile("clip.mov", 4, "video/quicktime")), true);
  assert.equal(isTranscodableVideoUpload(createFile("clip.MOV", 4, "video/x-quicktime")), true);
  assert.equal(isTranscodableVideoUpload(createFile("clip.webm", 4, "video/webm")), false);
});

test("upload status helpers distinguish active, completed and failed jobs", () => {
  assert.equal(isActiveUploadStatus("queued"), true);
  assert.equal(isActiveUploadStatus("uploading"), true);
  assert.equal(isActiveUploadStatus("processing"), true);
  assert.equal(isActiveUploadStatus("completed"), false);
  assert.equal(getUploadStatusLabel("processing"), "Processing");
  assert.equal(getUploadStatusLabel("failed"), "Failed");
  assert.equal(getVisibleUploadProgress({ progress: 125 }), 100);
  assert.equal(getVisibleUploadProgress({ progress: -10 }), 0);
});

test("shouldAutoCloseUploadModal closes only after uploads reach background processing", () => {
  assert.equal(shouldAutoCloseUploadModal([]), false);
  assert.equal(shouldAutoCloseUploadModal([{ status: "uploading" }, { status: "processing" }]), false);
  assert.equal(shouldAutoCloseUploadModal([{ status: "queued" }, { status: "processing" }]), false);
  assert.equal(shouldAutoCloseUploadModal([{ status: "processing" }, { status: "failed" }]), false);
  assert.equal(shouldAutoCloseUploadModal([{ status: "processing" }, { status: "cancelled" }]), false);
  assert.equal(shouldAutoCloseUploadModal([{ status: "processing" }, { status: "processing" }]), true);
  assert.equal(shouldAutoCloseUploadModal([{ status: "processing" }, { status: "completed" }]), true);
});
