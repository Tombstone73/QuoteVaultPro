import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DebugUser() {
  const { user, isLoading, isAuthenticated, isAdmin } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Debug: Current User Session</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <strong>Is Authenticated:</strong> {isAuthenticated ? "Yes" : "No"}
            </div>
            <div>
              <strong>Is Admin:</strong> {isAdmin ? "Yes" : "No"}
            </div>
            <div>
              <strong>User Object:</strong>
              <pre className="mt-2 p-4 bg-gray-100 rounded overflow-auto">
                {JSON.stringify(user, null, 2)}
              </pre>
            </div>
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
              <p className="font-semibold">Expected fields:</p>
              <ul className="list-disc list-inside mt-2">
                <li>id</li>
                <li>email</li>
                <li>isAdmin (or is_admin)</li>
                <li><strong>role</strong> (should be: owner, admin, manager, or employee)</li>
              </ul>
              <p className="mt-4">
                If the <strong>role</strong> field is missing, you need to <strong>log out and log back in</strong> to refresh your session.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

