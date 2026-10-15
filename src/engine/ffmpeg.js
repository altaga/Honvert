import { cancel, execute, onProgress, onStart } from "../../modules/honvert-engine";
import { getEngineLabels } from "./labels";

let counter = 0;

// Runs one FFmpeg command locally. `done` resolves with { success, cancelled, output }.
export function runFfmpeg(args, { outputDurationMs = 0, onFraction } = {}) {
  const id = `job-${Date.now()}-${++counter}`;
  let sessionId = null;

  const subscriptions = [
    onStart((event) => {
      if (event.id === id) sessionId = event.sessionId;
    }),
    onProgress((event) => {
      if (event.id === id && onFraction && outputDurationMs > 0) {
        onFraction(Math.min(1, event.timeMs / outputDurationMs));
      }
    }),
  ];

  const done = execute(id, args, outputDurationMs, getEngineLabels()).finally(() => {
    subscriptions.forEach((subscription) => subscription.remove());
  });

  return {
    done,
    cancel: () => {
      if (sessionId != null) cancel(sessionId);
    },
  };
}
