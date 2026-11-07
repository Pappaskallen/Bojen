import { systemClock } from "@bojen/adapters";
import { tasks } from "./tasks";

console.info(
  `[worker] ${systemClock.now().toISOString()} started with ${Object.keys(tasks).length} tasks`,
);
