import { NextResponse } from "next/server";

import { listBonusQuestionPools } from "@/lib/server/repositories/bonus-question-pools";

export async function GET() {
  const pools = await listBonusQuestionPools();
  return NextResponse.json({ data: pools });
}
