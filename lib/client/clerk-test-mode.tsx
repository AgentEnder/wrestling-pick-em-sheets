'use client'

import type { ComponentProps, PropsWithChildren } from 'react'

import {
  SignInButton as ClerkSignInButton,
  Show,
  UserButton as ClerkUserButton,
  useAuth as useClerkAuth,
  useUser as useClerkUser,
} from '@clerk/nextjs'

const isTestAuthClientMode = process.env.NEXT_PUBLIC_TEST_AUTH_MODE === '1'

export function SignedIn({ children }: PropsWithChildren) {
  if (isTestAuthClientMode) {
    return null
  }

  return <Show when="signed-in">{children}</Show>
}

export function SignedOut({ children }: PropsWithChildren) {
  if (isTestAuthClientMode) {
    return <>{children}</>
  }

  return <Show when="signed-out">{children}</Show>
}

export function SignInButton(props: PropsWithChildren<ComponentProps<typeof ClerkSignInButton>>) {
  if (isTestAuthClientMode) {
    return <>{props.children}</>
  }

  return <ClerkSignInButton {...props} />
}

export function UserButton(props: ComponentProps<typeof ClerkUserButton>) {
  if (isTestAuthClientMode) {
    return null
  }

  return <ClerkUserButton {...props} />
}

export function useAuth(): ReturnType<typeof useClerkAuth> {
  if (isTestAuthClientMode) {
    return {
      userId: null,
      sessionId: null,
      sessionClaims: null,
      actor: null,
      orgId: null,
      orgRole: null,
      orgSlug: null,
      isLoaded: true,
      isSignedIn: false,
      has: () => false,
      signOut: async () => undefined,
      getToken: async () => null,
    } as unknown as ReturnType<typeof useClerkAuth>
  }

  return useClerkAuth()
}

export function useUser(): ReturnType<typeof useClerkUser> {
  if (isTestAuthClientMode) {
    return {
      isLoaded: true,
      isSignedIn: false,
      user: null,
    } as ReturnType<typeof useClerkUser>
  }

  return useClerkUser()
}
