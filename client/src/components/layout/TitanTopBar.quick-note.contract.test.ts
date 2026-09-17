import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

const sourcePath = fs.existsSync(path.resolve(process.cwd(), "src/components/layout/TitanTopBar.tsx"))
  ? path.resolve(process.cwd(), "src/components/layout/TitanTopBar.tsx")
  : path.resolve(process.cwd(), "client/src/components/layout/TitanTopBar.tsx");
const source = fs.readFileSync(sourcePath, "utf8");

describe("TitanTopBar Quick Note availability", () => {
  test("exposes an accessible global control and mounts its dialog from local state", () => {
    expect(source).toContain('const [quickNoteOpen, setQuickNoteOpen] = React.useState(false)');
    expect(source).toContain('title="Quick Note" aria-label="Quick Note"');
    expect(source).toContain('onClick={() => setQuickNoteOpen(true)}');
    expect(source).toContain('<QuickNotePrintDialog open={quickNoteOpen} onOpenChange={setQuickNoteOpen} />');
  });
});
