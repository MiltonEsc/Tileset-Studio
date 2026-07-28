// Single source of truth for every localStorage key used in the app.
// Keeping them here avoids silent data loss from typos and makes the full set
// auditable at a glance.
export const STORAGE_KEYS = {
  // Preferred AI image model — shared across all AI panels on purpose, so the
  // user's model choice is global rather than per-panel.
  AI_IMAGE_MODEL: 'ai_image_model',
  // Preferred AI image quality (Assets panel only, today).
  AI_IMAGE_QUALITY: 'ai_image_quality',
  // Preferred AI text model (level idea assistant).
  AI_TEXT_MODEL: 'ai_text_model',
  // Auto-saved manual level editor draft.
  MANUAL_LEVEL: 'ts_manual_level_v1',
}
