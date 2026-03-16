/* ============================================================
   MODEL CAPABILITIES — Single Source of Truth
   
   Central registry for all Unlimited-compatible models.
   Consumed by BOTH app.js (UI) and higgsfield-engine.js (automation).
   
   Data verified against live Higgsfield site (March 2026).
   ============================================================ */

// ── All aspects available on the site ────────────────────────
const ALL_ASPECTS = ['Auto', '1:1', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9', '5:4', '4:5', '21:9'];

// ══════════════════════════════════════════════════════════════
//  UNLIMITED MODEL REGISTRY
//  Only models that support the Unlimited toggle on the site.
// ══════════════════════════════════════════════════════════════

const MODEL_REGISTRY = {
  nano_banana_pro: {
    name: 'Nano Banana Pro',
    slug: 'nano_banana_2',
    desc: 'Google — flagship generation model',
    // Unlimited-compatible quality options (4K exists on site but is paid-only)
    qualities: ['1K', '2K'],
    defaultQuality: '2K',
    // All 11 aspect ratios available
    aspects: ALL_ASPECTS,
    defaultAspect: '1:1',
    // Extra free gens toggle exists on this model
    hasExtraFreeGens: true,
    // Batch: 1/4 default
    defaultBatch: '1/4',
  },

  nano_banana: {
    name: 'Nano Banana',
    slug: 'nano_banana',
    desc: 'Google — standard generation model',
    // No quality selector on site
    qualities: [],
    defaultQuality: null,
    // All 11 aspect ratios available (confirmed: same full list)
    aspects: ALL_ASPECTS,
    defaultAspect: '1:1',
    // No Extra free gens toggle
    hasExtraFreeGens: false,
    defaultBatch: '1/4',
  },

  higgsfield_soul: {
    name: 'Higgsfield Soul',
    slug: 'soul',
    desc: 'Ultra-realistic fashion visuals',
    // Quality: 1.5k and 2k (site shows lowercase)
    qualities: ['1.5k', '2k'],
    defaultQuality: '2k',
    // Limited aspect ratios (7 total, no Auto, no 5:4, 4:5, 21:9)
    aspects: ['9:16', '3:4', '2:3', '1:1', '4:3', '16:9', '3:2'],
    defaultAspect: '1:1',
    // No Extra free gens toggle, has Style and Camera selectors
    hasExtraFreeGens: false,
    defaultBatch: '1/4',
  },

  z_image: {
    name: 'Z-Image',
    slug: 'z-image',
    desc: 'Instant lifelike portraits',
    // No quality selector on site
    qualities: [],
    defaultQuality: null,
    // Most restrictive: 5 aspect ratios only
    aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'],
    defaultAspect: '1:1',
    // No Extra free gens toggle
    hasExtraFreeGens: false,
    defaultBatch: '1/4',
  },
};

// ── Model IDs in display order ───────────────────────────────
const MODEL_ORDER = ['nano_banana_pro', 'nano_banana', 'higgsfield_soul', 'z_image'];

// ══════════════════════════════════════════════════════════════
//  PAID MODELS (blocked from Unlimited flow)
//  Listed here only for error messages / future reference.
// ══════════════════════════════════════════════════════════════

const PAID_MODELS = {
  gpt_image: 'GPT Image',
  seedream_5_lite: 'Seedream 5.0 lite',
  seedream_4_5: 'Seedream 4.5',
  flux_2_pro: 'FLUX.2 Pro',
  kling_o1: 'Kling O1',
};

// ══════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════

/**
 * Get capabilities for a model by ID.
 * Returns model object or null if not found / not Unlimited.
 */
function getModelCapabilities(modelId) {
  return MODEL_REGISTRY[modelId] || null;
}

/**
 * Check if a model supports Unlimited.
 */
function isUnlimitedModel(modelId) {
  return !!MODEL_REGISTRY[modelId];
}

/**
 * Resolve user-selected settings against model capabilities.
 * Auto-corrects incompatible values. Returns effective settings + any warnings.
 *
 * @param {{ model: string, quality: string|null, aspect: string, imagesPerPrompt: number }} userSettings
 * @returns {{ effective: object, warnings: Array, blocked: boolean, blockReason: string|null }}
 */
function resolveCompatibleSettings(userSettings) {
  const { model, quality, aspect, imagesPerPrompt } = userSettings;
  const caps = MODEL_REGISTRY[model];
  const warnings = [];

  // ── Blocked: model not Unlimited ──
  if (!caps) {
    const paidName = PAID_MODELS[model] || model;
    return {
      effective: userSettings,
      warnings: [],
      blocked: true,
      blockReason: `Модель "${paidName}" не поддерживает Unlimited. Доступные модели: ${MODEL_ORDER.map(id => MODEL_REGISTRY[id].name).join(', ')}.`,
    };
  }

  // ── Quality resolution ──
  let effectiveQuality = quality;
  if (caps.qualities.length === 0) {
    // No quality selector → null
    effectiveQuality = null;
  } else if (!quality || !caps.qualities.includes(quality)) {
    effectiveQuality = caps.defaultQuality;
    if (quality) {
      warnings.push({
        setting: 'quality',
        from: quality,
        to: effectiveQuality,
        message: `Качество "${quality}" недоступно для ${caps.name}. Установлено "${effectiveQuality}".`,
      });
    }
  }

  // ── Aspect ratio resolution ──
  let effectiveAspect = aspect;
  if (!aspect || !caps.aspects.includes(aspect)) {
    effectiveAspect = caps.defaultAspect;
    if (aspect) {
      warnings.push({
        setting: 'aspect',
        from: aspect,
        to: effectiveAspect,
        message: `Формат "${aspect}" недоступен для ${caps.name}. Установлено "${effectiveAspect}".`,
      });
    }
  }

  // ── Images per prompt (always valid for Unlimited: 1, 2, or 4) ──
  const effectiveImagesPerPrompt = [1, 2, 4].includes(imagesPerPrompt) ? imagesPerPrompt : 4;

  return {
    effective: {
      model,
      quality: effectiveQuality,
      aspect: effectiveAspect,
      imagesPerPrompt: effectiveImagesPerPrompt,
    },
    warnings,
    blocked: false,
    blockReason: null,
  };
}

/**
 * Get list of Unlimited model entries in display order.
 * Each entry: { id, name, slug, desc, qualities, aspects, ... }
 */
function getUnlimitedModelList() {
  return MODEL_ORDER.map(id => ({ id, ...MODEL_REGISTRY[id] }));
}

// ══════════════════════════════════════════════════════════════
//  BACKWARD-COMPATIBLE VIEWS
//  For engine code that uses UNLIMITED_MODELS / PAID_ONLY_MODELS format.
// ══════════════════════════════════════════════════════════════

// Engine-format: { modelId: { slug, name } }
const UNLIMITED_MODELS = {};
for (const id of MODEL_ORDER) {
  UNLIMITED_MODELS[id] = { slug: MODEL_REGISTRY[id].slug, name: MODEL_REGISTRY[id].name };
}

// Engine-format: { modelId: 'Display Name' }
const PAID_ONLY_MODELS = { ...PAID_MODELS };

// Engine-format: { modelId: ['quality1', 'quality2'] }
const MODEL_QUALITY_OPTIONS = {};
for (const id of MODEL_ORDER) {
  if (MODEL_REGISTRY[id].qualities.length > 0) {
    MODEL_QUALITY_OPTIONS[id] = MODEL_REGISTRY[id].qualities;
  }
}

// ══════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════

// Node.js (engine, main.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MODEL_REGISTRY,
    MODEL_ORDER,
    ALL_ASPECTS,
    PAID_MODELS,
    getModelCapabilities,
    isUnlimitedModel,
    resolveCompatibleSettings,
    getUnlimitedModelList,
    // Backward-compatible
    UNLIMITED_MODELS,
    PAID_ONLY_MODELS,
    MODEL_QUALITY_OPTIONS,
  };
}

// Browser (app.js) — will be loaded via <script> tag
// Variables are already global-scoped in this case.
