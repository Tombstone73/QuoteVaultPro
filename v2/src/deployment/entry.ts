import { createConsoleLogger } from "../observability/logger.js";
import {
  installV2DeploymentShutdownHandlers,
  startV2DeploymentServer,
} from "./server.js";

const logger = createConsoleLogger();
startV2DeploymentServer(process.env, logger)
  .then((server) => installV2DeploymentShutdownHandlers(server, logger))
  .catch(() => {
    logger.log("error", "v2.deployment.startup.failed", { errorCode: "CONFIGURATION_ERROR" });
    process.exitCode = 1;
  });
