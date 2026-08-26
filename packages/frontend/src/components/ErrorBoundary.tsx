import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort guard so a render-time throw anywhere in the tree shows a
 * recoverable message instead of unmounting the app into a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight:      "100vh",
          display:        "flex",
          flexDirection:  "column",
          alignItems:     "center",
          justifyContent: "center",
          gap:            "1.25rem",
          padding:        "2rem",
          background:     "#000",
          color:          "#fff",
          fontFamily:     "monospace",
          textAlign:      "center",
        }}
      >
        <h1 style={{ letterSpacing: "0.3em", fontSize: "1.25rem" }}>
          SOMETHING BROKE
        </h1>
        <p style={{ color: "#888", maxWidth: "40rem", lineHeight: 1.6 }}>
          {error.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding:    "0.75rem 2rem",
            background: "transparent",
            border:     "1px solid #fff",
            color:      "#fff",
            fontFamily: "monospace",
            letterSpacing: "0.2em",
            cursor:     "pointer",
          }}
        >
          RELOAD
        </button>
      </div>
    );
  }
}
