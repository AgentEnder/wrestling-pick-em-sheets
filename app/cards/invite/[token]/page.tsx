import { CardInviteAccept } from "@/app/cards/invite/[token]/card-invite-accept";

interface CardInvitePageProps {
  params: Promise<{
    token: string;
  }>;
}

export default async function CardInvitePage({ params }: CardInvitePageProps) {
  const { token } = await params;

  return <CardInviteAccept token={token} />;
}
