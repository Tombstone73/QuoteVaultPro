import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

copyFileSync(resolve("local-file-renamer", "bulk-file-renamer.py"), resolve("dist", "bulk-file-renamer.py"));
