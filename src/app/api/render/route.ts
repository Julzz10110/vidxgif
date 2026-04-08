import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

export const runtime = "nodejs";

type Overlay = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
};

function safeJsonParse<T>(value: string): T {
  return JSON.parse(value) as T;
}

async function writeFileToTmp(file: File, filename: string) {
  const buf = Buffer.from(await file.arrayBuffer());
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vidxgif-"));
  const filePath = path.join(tmpDir, filename);
  await fs.writeFile(filePath, buf);
  return { tmpDir, filePath };
}

function runFfmpeg(args: string[]) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static не смог определить путь к ffmpeg.");
  }
  const raw = ffmpegPath as string;
  const cwd = process.cwd();

  // On Windows, some bundlers/environments rewrite the path to a placeholder like:
  // "\ROOT\node_modules\ffmpeg-static\ffmpeg.exe"
  // which is not a real path on disk. Map it back to the project root.
  const resolved =
    raw.startsWith("\\ROOT\\") || raw.startsWith("/ROOT/")
      ? path.join(cwd, raw.replace(/^\\ROOT\\|^\/ROOT\//, ""))
      : raw;
  const candidates = [
    resolved,
    path.join(cwd, "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(cwd, "node_modules", "ffmpeg-static", "ffmpeg"),
  ];
  const bin = candidates.find((p) => typeof p === "string" && p.length > 0 && existsSync(p));
  if (!bin) {
    throw new Error(
      `FFmpeg binary not found.\n` +
        `ffmpeg-static returned: ${raw}\n` +
        `Tried:\n- ${candidates.join("\n- ")}`
    );
  }

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg at: ${bin}\n${String(err)}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`FFmpeg exit ${code}\nCommand: ${bin} ${args.join(" ")}\n\n${stderr}`));
    });
  });
}

export async function POST(req: Request) {
  const cleanupDirs: string[] = [];
  try {
    const form = await req.formData();
    const video = form.get("video");
    const gifs = form.getAll("gifs");
    const overlaysRaw = form.get("overlays");

    if (!(video instanceof File)) {
      return new Response("Missing 'video' file", { status: 400 });
    }
    if (!Array.isArray(gifs) || gifs.length === 0) {
      return new Response("Missing 'gifs' files", { status: 400 });
    }
    if (typeof overlaysRaw !== "string") {
      return new Response("Missing 'overlays' json", { status: 400 });
    }

    const overlays = safeJsonParse<Overlay[]>(overlaysRaw);
    const gifFiles = gifs.filter((g): g is File => g instanceof File);

    if (gifFiles.length !== overlays.length) {
      return new Response("Count mismatch between gifs and overlays", { status: 400 });
    }

    const { tmpDir: videoTmp, filePath: videoPath } = await writeFileToTmp(video, "input-video");
    cleanupDirs.push(videoTmp);

    const gifPaths: string[] = [];
    for (let i = 0; i < gifFiles.length; i++) {
      const { tmpDir, filePath } = await writeFileToTmp(gifFiles[i], `overlay-${i}.gif`);
      cleanupDirs.push(tmpDir);
      gifPaths.push(filePath);
    }

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "vidxgif-out-"));
    cleanupDirs.push(outDir);
    const outPath = path.join(outDir, "edited.mp4");

    // Inputs:
    // 0: video
    // 1..N: gifs
    const args: string[] = ["-y", "-i", videoPath];
    gifPaths.forEach((p) => {
      args.push("-ignore_loop", "0", "-i", p);
    });

    const filterParts: string[] = [];

    // Start with base video
    let currentLabel = "[0:v]";

    for (let i = 0; i < overlays.length; i++) {
      const inputIndex = i + 1;
      const o = overlays[i];
      const gifLabel = `[g${i}]`;
      const outLabel = i === overlays.length - 1 ? "[vout]" : `[tmp${i}]`;

      // Scale + rotate each GIF, then overlay it.
      // rotationDeg is degrees, rotate filter expects radians.
      const angleExpr = `${o.rotationDeg}*PI/180`;
      filterParts.push(
        `[${inputIndex}:v]scale=${o.width}:${o.height},format=rgba,rotate='${angleExpr}':c=none:ow=rotw(iw):oh=roth(ih)${gifLabel}`
      );
      filterParts.push(`${currentLabel}${gifLabel}overlay=${o.x}:${o.y}:shortest=1${outLabel}`);
      currentLabel = outLabel;
    }

    const filterComplex = filterParts.join(";");

    args.push(
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outPath
    );

    await runFfmpeg(args);

    const outBuf = await fs.readFile(outPath);
    return new Response(outBuf, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="edited.mp4"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(message, {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await Promise.all(
      cleanupDirs.map(async (dir) => {
        try {
          await fs.rm(dir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      })
    );
  }
}

