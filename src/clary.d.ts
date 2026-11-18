export {}

declare global {
  interface Window {
    claryDesktop?: {
      onAuthCallback: (callback: (url: string) => void) => () => void
    }
  }
}