export type Toast = {
  title: string
  description?: string
  duration?: number
  type: 'info' | 'success' | 'error' | 'warning'
  notificationId?: string
}

export const sharedValue = 1
