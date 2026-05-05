// Shared animation timing tokens for the brutalist dashboard. Centralised so
// every "snap" motion across panels uses the same brutalist-grade easing.
export const SNAP_EASING = 'cubic-bezier(0.85, 0, 0.15, 1)';
export const SNAP_DURATION_MS = 120;
export const SNAP_TRANSITION = `transform ${SNAP_DURATION_MS}ms ${SNAP_EASING}`;
