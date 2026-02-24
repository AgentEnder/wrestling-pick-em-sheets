import { auth, currentUser } from '@clerk/nextjs/server'

const ADMIN_EMAIL = 'craigorycoppola@gmail.com'

export async function getRequestUserId() {
  const { userId } = await auth()
  return userId
}

export async function getRequestUserEmail(): Promise<string | null> {
  const user = await currentUser()
  if (!user) return null

  const emailAddresses = Array.isArray(user.emailAddresses) ? user.emailAddresses : []
  const primaryEmail =
    emailAddresses.find((email) => email.id === user.primaryEmailAddressId) ??
    emailAddresses[0]

  return primaryEmail?.emailAddress?.trim().toLowerCase() ?? null
}

export async function isRequestAdminUser(): Promise<boolean> {
  const email = await getRequestUserEmail()
  return email === ADMIN_EMAIL
}
