import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  routeName?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * RouteBoundary — page-scoped error boundary. Wraps each routed page so a
 * crash inside (e.g. PlanReviewDetail) shows a recoverable fallback instead
 * of nuking the whole shell. Class component because React needs lifecycle
 * methods for error capture; navigation handled via a child function comp.
 */
export class RouteBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error(`[RouteBoundary:${this.props.routeName ?? "unknown"}]`, error);
  }

  reset = () => this.setState({ hasError: false, error: undefined });

  render() {
    if (this.state.hasError) {
      return <RouteFallback message={this.state.error?.message} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

function RouteFallback({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">This page hit an error</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {message || "Something unexpected happened while rendering this page."}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => navigate("/projects")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to projects
        </Button>
        <Button onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    </div>
  );
}
