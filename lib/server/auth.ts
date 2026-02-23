import { auth } from '@clerk/nextjs/server'

export async function getRequestUserId() {
  const { userId } = await auth()
  return userId
}
