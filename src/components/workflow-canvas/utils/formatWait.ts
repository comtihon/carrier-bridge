/**
 * Format a wait duration (in seconds) as a human-readable string.
 * Single source of truth used by both WorkflowDetail and GraphVisualization.
 */
export function formatWaitDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}
