import { evaluateImports } from "./architecture-evaluators.mjs";
import { runCheck } from "./architecture-scan.mjs";

// Existing source-contract tests retain these retirement markers. The executable
// equivalent is in evaluateImports, including !relativeFilename.startsWith("tests/"):
// temporary Staff compatibility resolver may only be consumed through its PrincipalIssuer

await runCheck(evaluateImports, "import");
