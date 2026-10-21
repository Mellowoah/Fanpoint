import { Suspense } from "react";
import RoutedApp from "@/components/RoutedApp";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-10 text-sm opacity-60">Loading Routed…</div>}>
      <RoutedApp />
    </Suspense>
  );
}
