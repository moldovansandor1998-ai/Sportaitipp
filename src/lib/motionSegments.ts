export interface MotionSegment { start: number; duration: number; }

/** Continuous coverage, including a short tail: borrow time instead of dropping it. */
export function planMotionSegments(seconds: number): MotionSegment[] {
  if (!Number.isFinite(seconds) || seconds < 3 || seconds > 300) throw new Error("MOTION_DURATION_LIMIT");
  const segments: MotionSegment[] = [];
  let start = 0;
  while (seconds - start > 0.001) {
    let duration = Math.min(30, seconds - start);
    const tail = seconds - start - duration;
    if (tail > 0.001 && tail < 3) duration -= 3 - tail;
    segments.push({ start: Number(start.toFixed(3)), duration: Number(duration.toFixed(3)) });
    start += duration;
  }
  return segments;
}

export function motionCredits(segments: MotionSegment[], standard: boolean): number {
  return Math.ceil(segments.reduce((sum, segment) => sum + Math.ceil(segment.duration), 0) * (standard ? 25.2 : 50.4));
}

export function motionPartFromPath(path: string, sequence?: string) {
  const match = path.match(/\/0-resz-(\d+)-(\d+)\.mp4$/);
  return match ? { index: Number(match[1]), total: Number(match[2]), sequence: sequence ?? path.split("/").at(-2) } : null;
}
