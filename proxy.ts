import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { serverEnv } from '@/lib/server/env'
import { isTestAuthRuntimeEnabled } from '@/lib/server/test-auth-guard'

const shouldBypassClerk = isTestAuthRuntimeEnabled({
  TEST_AUTH_MODE: serverEnv.TEST_AUTH_MODE,
  TEST_AUTH_SECRET: serverEnv.TEST_AUTH_SECRET,
  NEXT_PUBLIC_TEST_AUTH_MODE: serverEnv.NEXT_PUBLIC_TEST_AUTH_MODE,
  VERCEL: serverEnv.VERCEL,
  VERCEL_ENV: serverEnv.VERCEL_ENV,
})

const middleware = shouldBypassClerk
  ? () => NextResponse.next()
  : clerkMiddleware()

export default middleware

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
