import { evaluateSql } from "./architecture-evaluators.mjs";
import { runCheck } from "./architecture-scan.mjs";

await runCheck(evaluateSql, "sql");
