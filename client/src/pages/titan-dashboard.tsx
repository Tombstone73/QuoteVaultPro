import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TitanDashboard() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Titan Dashboard</h1>
        <p className="text-sm text-muted-foreground">Landing page placeholder for live testing.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Content Area</CardTitle>
        </CardHeader>
        <CardContent className="min-h-[280px]" />
      </Card>
    </div>
  );
}
