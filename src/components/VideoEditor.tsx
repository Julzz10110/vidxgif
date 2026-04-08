"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GifOverlay, RenderOverlay } from "@/types/video-editor";
import { GifOverlayEditor } from "@/components/GifOverlayEditor";

type ExportState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "rendering" }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

export function VideoEditor() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [gifs, setGifs] = useState<GifOverlay[]>([]);
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  const [isEditMode, setIsEditMode] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gifInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      gifs.forEach((g) => URL.revokeObjectURL(g.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canExport = useMemo(() => Boolean(videoFile && gifs.length > 0), [videoFile, gifs.length]);

  const onUploadVideo = useCallback((file: File) => {
    setVideoFile(file);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  }, []);

  const onAddGif = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const id = crypto.randomUUID();
    setGifs((prev) => [
      ...prev,
      {
        id,
        file,
        url,
        position: { x: 24, y: 24 },
        size: { width: 180, height: 180 },
        rotationDeg: 0,
        isVisible: true,
      },
    ]);
  }, []);

  const updateGifPosition = useCallback((id: string, position: { x: number; y: number }) => {
    setGifs((prev) => prev.map((g) => (g.id === id ? { ...g, position } : g)));
  }, []);

  const updateGifSize = useCallback((id: string, size: { width: number; height: number }) => {
    setGifs((prev) => prev.map((g) => (g.id === id ? { ...g, size } : g)));
  }, []);

  const updateGifRotation = useCallback((id: string, rotationDeg: number) => {
    const normalized = Number.isFinite(rotationDeg)
      ? ((rotationDeg % 360) + 360) % 360
      : 0;
    setGifs((prev) => prev.map((g) => (g.id === id ? { ...g, rotationDeg: normalized } : g)));
  }, []);

  const removeGif = useCallback((id: string) => {
    setGifs((prev) => {
      const victim = prev.find((g) => g.id === id);
      if (victim) URL.revokeObjectURL(victim.url);
      return prev.filter((g) => g.id !== id);
    });
  }, []);

  const toggleVisible = useCallback((id: string) => {
    setGifs((prev) => prev.map((g) => (g.id === id ? { ...g, isVisible: !g.isVisible } : g)));
  }, []);

  const handleVideoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUploadVideo(file);
    e.target.value = "";
  };

  const handleGifInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onAddGif(file);
    e.target.value = "";
  };

  const exportVideo = useCallback(async () => {
    if (!videoFile) return;
    if (!stageRef.current) return;
    if (!videoRef.current) return;

    const rect = stageRef.current.getBoundingClientRect();
    const videoWidth = videoRef.current.videoWidth || rect.width;
    const videoHeight = videoRef.current.videoHeight || rect.height;

    if (!videoWidth || !videoHeight) {
      setExportState({
        status: "error",
        message: "Could not determine the video size. Try playing the video once and retry.",
      });
      return;
    }

    const scaleX = videoWidth / rect.width;
    const scaleY = videoHeight / rect.height;

    const visibleGifs = gifs.filter((g) => g.isVisible);
    if (visibleGifs.length === 0) {
      setExportState({ status: "error", message: "No visible GIF overlays to export." });
      return;
    }

    const overlays: RenderOverlay[] = visibleGifs.map((g) => ({
      x: Math.round(g.position.x * scaleX),
      y: Math.round(g.position.y * scaleY),
      width: Math.max(1, Math.round(g.size.width * scaleX)),
      height: Math.max(1, Math.round(g.size.height * scaleY)),
      rotationDeg: g.rotationDeg,
    }));

    const form = new FormData();
    form.append("video", videoFile, videoFile.name);
    visibleGifs.forEach((g) => form.append("gifs", g.file, g.file.name));
    form.append("overlays", JSON.stringify(overlays));

    setExportState({ status: "uploading" });
    try {
      const res = await fetch("/api/render", { method: "POST", body: form });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      setExportState({ status: "rendering" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setExportState({ status: "done", url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setExportState({ status: "error", message });
    }
  }, [gifs, videoFile]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">vidxgif</h1>
          <p className="text-sm text-zinc-400">
            Browser preview, server-side FFmpeg export (audio preserved).
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <button
            type="button"
            className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-600"
            onClick={() => fileInputRef.current?.click()}
          >
            Upload video
          </button>
          <button
            type="button"
            className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-600 disabled:opacity-50"
            onClick={() => gifInputRef.current?.click()}
            disabled={!videoFile}
            title={!videoFile ? "Upload a video first" : undefined}
          >
            Add GIF
          </button>
          <button
            type="button"
            className="rounded-lg bg-zinc-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-400 disabled:opacity-50"
            onClick={() => void exportVideo()}
            disabled={!canExport || exportState.status === "uploading" || exportState.status === "rendering"}
            title={!canExport ? "Requires a video and at least one GIF" : undefined}
          >
            Export MP4
          </button>
          <button
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              isEditMode ? "bg-zinc-100 text-zinc-900 hover:bg-white" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
            }`}
            onClick={() => setIsEditMode((v) => !v)}
            disabled={!videoFile}
            title={!videoFile ? "Upload a video first" : "Toggle overlay editing"}
          >
            {isEditMode ? "Editing: ON" : "Editing: OFF"}
          </button>

          <div className="ml-auto flex items-center gap-2 text-xs text-zinc-300">
            <span className="rounded-md bg-zinc-800 px-2 py-1">
              GIF: {gifs.length}
            </span>
            <span className="rounded-md bg-zinc-800 px-2 py-1">
              Status: {exportState.status}
            </span>
          </div>

          <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoInput} />
          <input ref={gifInputRef} type="file" accept="image/gif" className="hidden" onChange={handleGifInput} />
        </div>

        {exportState.status === "error" && (
          <div className="mt-4 rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-100">
            {exportState.message}
          </div>
        )}

        {exportState.status === "done" && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-100">
            <div>Done. Download:</div>
            <a className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500" href={exportState.url} download="edited.mp4">
              Download MP4
            </a>
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div
              ref={stageRef}
              id="video-stage"
              className="relative overflow-hidden rounded-lg bg-black"
            >
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    className="block h-auto w-full"
                    onPlay={() => {
                      // triggers videoWidth/videoHeight availability in some browsers
                    }}
                  />
                  <div className="absolute inset-0 pointer-events-none">
                    {gifs.map((gif) => (
                      <div key={gif.id} className={isEditMode ? "pointer-events-auto" : "pointer-events-none"}>
                        <GifOverlayEditor
                          gif={gif}
                          boundsSelector="#video-stage"
                          isInteractive={isEditMode}
                          onUpdatePosition={updateGifPosition}
                          onUpdateSize={updateGifSize}
                          onUpdateRotation={updateGifRotation}
                          onRemove={removeGif}
                          onToggleVisible={toggleVisible}
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex aspect-video w-full items-center justify-center text-sm text-zinc-400">
                  Upload a video to get started.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="text-sm font-medium text-zinc-100">Layers</div>
            <div className="mt-3 space-y-2">
              {gifs.length === 0 ? (
                <div className="text-sm text-zinc-400">No GIF overlays yet.</div>
              ) : (
                gifs.map((g, idx) => (
                  <div key={g.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g.url} alt="" className="h-10 w-10 rounded bg-black object-contain" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-zinc-200">GIF #{idx + 1}</div>
                      <div className="text-[11px] text-zinc-400">
                        x={Math.round(g.position.x)} y={Math.round(g.position.y)} w={Math.round(g.size.width)} h={Math.round(g.size.height)}
                        {" "}rot={Math.round(g.rotationDeg)}°
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
                      onClick={() => updateGifRotation(g.id, g.rotationDeg - 15)}
                      title="Rotate left"
                    >
                      ⟲
                    </button>
                    <button
                      type="button"
                      className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
                      onClick={() => updateGifRotation(g.id, g.rotationDeg + 15)}
                      title="Rotate right"
                    >
                      ⟳
                    </button>
                    <button
                      type="button"
                      className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
                      onClick={() => toggleVisible(g.id)}
                      title="Show/hide"
                    >
                      {g.isVisible ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      className="rounded bg-red-600/90 px-2 py-1 text-xs text-white hover:bg-red-600"
                      onClick={() => removeGif(g.id)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 text-xs leading-5 text-zinc-400">
              Export is done via FFmpeg:
              <ul className="mt-2 list-disc pl-5">
                <li>Video is encoded as H.264 (MP4)</li>
                <li>Audio is preserved (AAC)</li>
                <li>GIFs are applied as animated overlays</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

