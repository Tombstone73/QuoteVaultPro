import React, { Component, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Simple Error Boundary to prevent PBV2 option detail panel crashes from blanking the entire screen.
 * Catches errors in child components and displays a fallback UI with reset button.
 * Pass key={selectedGroupId + selectedOptionId} to auto-reset when selection changes.
 * Pass onReset to clear stale selection that may have caused the crash.
 */
export class PBV2EditorErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[PBV2EditorErrorBoundary] Caught error:', error, errorInfo);
    // Notify parent to clear stale selection that likely caused the crash
    this.props.onReset?.();
  }

  handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Card className="m-4 border-destructive">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <CardTitle className="text-destructive">Editor Error</CardTitle>
            </div>
            <CardDescription>
              The PBV2 option editor encountered an error. Try resetting the view or reloading the page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm font-mono text-muted-foreground bg-muted p-3 rounded">
              {this.state.error?.message || 'Unknown error'}
            </div>
            <Button onClick={this.handleReset} variant="outline">
              Reset Editor
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
