import { Suspense } from "react";
import LiveClient from "./live-client";

export default function LivePage() {
  return (
    <Suspense fallback={null}>
      <LiveClient />
    </Suspense>
  );
}
