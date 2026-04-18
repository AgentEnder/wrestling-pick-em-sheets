import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";

export function PlayerCanceledView() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <Ban className="h-12 w-12 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold">Game canceled</h1>
      <p className="text-sm text-muted-foreground">
        The host ended this game early. Your picks and any scoring for this
        session have been removed.
      </p>
      <Button asChild variant="outline" className="mt-4">
        <Link href="/">Return home</Link>
      </Button>
    </div>
  );
}
