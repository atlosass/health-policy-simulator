/**
 * Background runner: one simulation per message, so the page stays responsive
 * while the extra runs behind the ranges are computed.
 */
import { runSimulation } from "../engine/index.ts";
import type { SimConfig } from "../engine/index.ts";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; cfg: SimConfig }>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => {
  const { id, cfg } = e.data;
  scope.postMessage({ id, result: runSimulation(cfg) });
};
