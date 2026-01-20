import { Card } from "@/components/ui/card";

export default function Prepress() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Prepress</h2>
      </div>
      <Card className="p-6">
        <p className="text-muted-foreground">
          Prepress module - manage artwork preparation, proofing, and approval workflows.
        </p>
      </Card>
    </div>
  );
}
