import { PostHog } from 'posthog-node'
import { v4 as uuidv4 } from 'uuid'

export enum EVENT_TYPES {
  WORKFLOW_SUMMARY = 'workflow_summary',
}

export type PostHogEvent = {
  event: EVENT_TYPES
  userId?: string
  properties?: Record<string, any>
}

// Only initialize if you've actually set a PostHog key
const posthogClient = process.env.NEXT_PUBLIC_POSTHOG_KEY
  ? new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    })
  : null

export const posthog = {
  capture: (event: PostHogEvent) => {
    if (!posthogClient) return
    posthogClient.capture({
      distinctId: event.userId || uuidv4(),
      event: event.event,
      properties: event.properties || {},
    })
  },
  flush: () => {
    posthogClient?.flush()
  },
}