import { notFound } from "next/navigation";

import { RosterAdminScreen } from "@/components/admin/roster-admin-screen";
import { isRequestAdminUser } from "@/lib/server/auth";

export default async function RosterAdminPage() {
  const isAdmin = await isRequestAdminUser();

  if (!isAdmin) {
    notFound();
  }

  return <RosterAdminScreen />;
}
