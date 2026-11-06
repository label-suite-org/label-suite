import { lazy, Suspense } from "react";

// The build-time guard keeps the annotation package out of production bundles.
const Feedback = import.meta.env.DEV && import.meta.env.PUBLIC_VISUAL_FEEDBACK === "true"
  ? lazy(() => import("agentation").then(({ Agentation }) => ({ default: Agentation })))
  : null;

export function DevFeedback() {
  return Feedback ? <Suspense fallback={null}>
    <Feedback endpoint="http://localhost:4747" appName="Label Suite development" />
  </Suspense> : null;
}
