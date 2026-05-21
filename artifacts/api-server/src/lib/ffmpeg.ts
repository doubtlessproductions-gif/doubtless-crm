import ffmpeg from "fluent-ffmpeg";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join, extname } from "path";
import { randomUUID } from "crypto";

export interface ProcessedVideo {
  watermarkedBuffer: Buffer;
  previewBuffer: Buffer;
  thumbnailBuffer: Buffer;
  durationSeconds: number;
}

function runFfmpeg(command: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    command.on("end", () => resolve()).on("error", reject).run();
  });
}

function probeDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration ?? 0);
    });
  });
}

export async function processVideoForWatermark(
  inputPath: string,
  projectId: number,
  watermarkText = "DOUBTLESS PRODUCTIONS © UNPAID — WATERMARK COPY",
): Promise<ProcessedVideo> {
  const tmpDir = tmpdir();
  const uid = randomUUID();

  const watermarkedPath = join(tmpDir, `${uid}_watermarked.mp4`);
  const previewPath     = join(tmpDir, `${uid}_preview.mp4`);
  const thumbnailPath   = join(tmpDir, `${uid}_thumb.jpg`);

  try {
    const durationSeconds = await probeDuration(inputPath);

    // 1. Watermark: drawtext repeated across the frame
    await runFfmpeg(
      ffmpeg(inputPath)
        .videoFilter([
          `drawtext=text='${watermarkText}':fontsize=28:fontcolor=white@0.55:x=(w-text_w)/2:y=h*0.15:shadowcolor=black@0.6:shadowx=2:shadowy=2`,
          `drawtext=text='${watermarkText}':fontsize=28:fontcolor=white@0.55:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.6:shadowx=2:shadowy=2`,
          `drawtext=text='${watermarkText}':fontsize=28:fontcolor=white@0.55:x=(w-text_w)/2:y=h*0.75:shadowcolor=black@0.6:shadowx=2:shadowy=2`,
        ])
        .audioCodec("copy")
        .output(watermarkedPath)
        .outputOptions(["-movflags +faststart"]),
    );

    // 2. 30-second preview (first 30s of the original, no watermark)
    await runFfmpeg(
      ffmpeg(inputPath)
        .outputOptions(["-t 30", "-movflags +faststart"])
        .videoCodec("copy")
        .audioCodec("copy")
        .output(previewPath),
    );

    // 3. Thumbnail at 5s (or 10% into the video if shorter)
    const thumbAt = Math.min(5, durationSeconds * 0.1);
    await runFfmpeg(
      ffmpeg(inputPath)
        .outputOptions([`-ss ${thumbAt}`, "-vframes 1", "-q:v 3"])
        .output(thumbnailPath),
    );

    const [watermarkedBuffer, previewBuffer, thumbnailBuffer] = await Promise.all([
      fs.readFile(watermarkedPath),
      fs.readFile(previewPath),
      fs.readFile(thumbnailPath),
    ]);

    return { watermarkedBuffer, previewBuffer, thumbnailBuffer, durationSeconds: Math.round(durationSeconds) };
  } finally {
    // Clean up temp files (best-effort)
    await Promise.allSettled([
      fs.unlink(watermarkedPath),
      fs.unlink(previewPath),
      fs.unlink(thumbnailPath),
    ]);
  }
}
