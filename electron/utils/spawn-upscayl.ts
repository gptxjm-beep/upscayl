import { spawn } from "child_process";
import { execPath, enhancedExecPath } from "./get-resource-paths";

export const spawnUpscayl = (
  command: string[],
  logit: (...args: any) => void,
  enhanced = false,
) => {
  logit(
    "📢 Upscayl Command: ",
    command.filter((arg) => arg !== ""),
  );

  const spawnedProcess = spawn(
    enhanced ? enhancedExecPath : execPath,
    command.filter((arg) => arg !== ""),
    {
      cwd: undefined,
      detached: false,
    },
  );

  return {
    process: spawnedProcess,
    kill: () => spawnedProcess.kill(),
  };
};
