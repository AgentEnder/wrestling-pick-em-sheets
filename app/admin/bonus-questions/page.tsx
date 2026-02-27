import { notFound } from "next/navigation";

import { BonusQuestionAdminScreen } from "@/components/admin/bonus-question-admin-screen";
import { isRequestAdminUser } from "@/lib/server/auth";

export default async function BonusQuestionAdminPage() {
  const isAdmin = await isRequestAdminUser();

  if (!isAdmin) {
    notFound();
  }

  return <BonusQuestionAdminScreen />;
}
