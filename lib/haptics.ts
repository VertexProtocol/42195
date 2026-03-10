/**
 * Haptic feedback utility for PWA apps
 * Uses the Vibration API supported by most modern browsers and mobile devices
 */

export type HapticType = "light" | "medium" | "heavy" | "success" | "error" | "warning"

const VIBRATION_PATTERNS: Record<HapticType, number | number[]> = {
  light: 10,
  medium: 30,
  heavy: 50,
  success: [30, 50, 30],
  error: [50, 30, 50],
  warning: [50, 100, 50],
}

/**
 * Trigger haptic feedback if supported by device
 * @param type - Type of haptic feedback
 */
export function triggerHaptic(type: HapticType = "light"): void {
  if (typeof window === "undefined") return
  
  const pattern = VIBRATION_PATTERNS[type]
  
  // Check if Vibration API is available
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch (e) {
      // Silently fail if vibration is not supported or denied
      console.debug("Haptic feedback not available or denied")
    }
  }
}

/**
 * Trigger haptic feedback on button press
 */
export function hapticClick(): void {
  triggerHaptic("light")
}

/**
 * Trigger haptic feedback on successful action
 */
export function hapticSuccess(): void {
  triggerHaptic("success")
}

/**
 * Trigger haptic feedback on error
 */
export function hapticError(): void {
  triggerHaptic("error")
}

/**
 * Trigger haptic feedback for warning
 */
export function hapticWarning(): void {
  triggerHaptic("warning")
}
