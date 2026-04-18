export function DisplayCanceledView() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 text-center">
      <h1 className="text-6xl font-bold">Game canceled</h1>
      <p className="text-2xl text-muted-foreground">
        This live game has been canceled by the host.
      </p>
    </div>
  );
}
