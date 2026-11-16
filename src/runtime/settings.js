// Fixed theme/feature configuration. Feature defaults come from the pinned upstream config.js
// (via upstream-meta.generated.json); the overrides below force the opt-out features off.
import meta from './upstream-meta.generated.json' with { type: 'json' };

export const FORCED_OFF = Object.freeze(['hidemeetings', 'dimmeetings', 'readablewidth', 'shortcuts']);

export function createSettings(overrides = {}) {
  const features = {};
  for (const f of meta.FEATURES) features[f.id] = f.default;
  for (const id of FORCED_OFF) features[id] = false;
  const known = new Set(meta.themes);
  const theme = known.has(overrides.theme) ? overrides.theme : meta.theme;
  for (const [id, on] of Object.entries(overrides.features || {})) {
    if (id in features && typeof on === 'boolean') features[id] = on;
  }
  return Object.freeze({ theme, features: Object.freeze(features) });
}

export const DEFAULT_SETTINGS = createSettings();
