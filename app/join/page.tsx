import { Suspense } from "react";

import JoinPageClient from "./join-page-client";

export default function JoinPage() {
  return (
    <Suspense fallback={<JoinPageFallback />}>
      <JoinPageClient />
    </Suspense>
  );
}

function JoinPageFallback() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <div className="w-full rounded-xl border border-border bg-card p-5">
        <h1 className="text-2xl font-semibold">Join Live Game</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Loading join form...
        </p>
      </div>
    </div>
  );
}
