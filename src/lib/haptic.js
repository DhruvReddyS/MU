/**
 * TRINETRA — Haptic Feedback
 * Wraps navigator.vibrate with named patterns.
 * Silently no-ops on unsupported devices.
 */

const PATTERNS = {
  light:    [30],
  medium:   [60],
  heavy:    [120],
  double:   [40, 60, 40],
  success:  [50, 40, 100],
  error:    [80, 50, 80, 50, 80],
  sos:      [100, 80, 100, 80, 300, 80, 100, 80, 100],
  connect:  [40, 30, 80],
  message:  [25],
  hold_tick:[15],
};

export function haptic(pattern = 'light') {
  try {
    if (!navigator.vibrate) return;
    navigator.vibrate(PATTERNS[pattern] ?? [30]);
  } catch {}
}
