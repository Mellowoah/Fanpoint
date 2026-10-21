import { Suspense } from "react";
import { connection } from "next/server";
import RoutedApp from "@/components/RoutedApp";
import { publicModes } from "@/lib/config";

/** Reads the provider modes per request, so the first render already has the right demo (live acts need live Qloo). */
async function App() {
  await connection();
  return <RoutedApp initialModes={publicModes()} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-plain">Loading Fanpoint…</div>}>
      <App />
    </Suspense>
  );
}
