// Level "idea cards" assistant: turns an LLM JSON response into a safe list of
// concepts the procedural generators can realize. The model only ever proposes
// { generator, params }; the app generates the grid deterministically, so the
// output is always valid regardless of what the model returns.
import { GENERATORS, GENERATOR_PARAMS, sanitizeParams, randomSeed } from './levelGenerator.js'

const MAX_IDEAS = 6

// Describes the available generators + their tunable params (with ranges) so the
// model picks valid knobs. Built from GENERATOR_PARAMS so it can never drift.
export function buildIdeaSystemPrompt() {
  const gens = Object.entries(GENERATORS).map(([key, g]) => {
    const params = (GENERATOR_PARAMS[key] || [])
      .map(p => `${p.key} (${p.min}..${p.max})`)
      .join(', ') || 'none'
    return `- "${key}" (${g.label}): params ${params}`
  }).join('\n')

  return [
    'You are a level-design assistant for a 2D tile game.',
    'Propose creative level concepts that are realized by these procedural generators:',
    gens,
    '',
    'Respond with ONLY a JSON object of this exact shape:',
    '{ "ideas": [ { "name": string, "description": string, "generator": string, "params": object, "seed": integer } ] }',
    'Rules:',
    `- 3 to ${MAX_IDEAS} ideas.`,
    '- "generator" MUST be one of the keys above.',
    '- "params" keys MUST be from that generator\'s param list, values within range.',
    '- "name": 2-4 words. "description": one short sentence on the vibe/layout.',
    '- "seed": any 32-bit integer.',
    '- No text outside the JSON object.',
  ].join('\n')
}

export function buildIdeaUserPrompt(theme) {
  const t = (theme || '').trim()
  return t
    ? `Suggest level ideas for this theme: "${t}".`
    : 'Suggest a varied set of interesting level ideas.'
}

// Parses + sanitizes the model output into a safe idea list. Accepts a JSON
// string or an already-parsed object. Throws only if the JSON is unparseable;
// individual malformed ideas are dropped, not fatal.
export function parseIdeas(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  const list = Array.isArray(data) ? data : (Array.isArray(data?.ideas) ? data.ideas : [])

  const ideas = []
  for (const item of list) {
    const generator = item?.generator
    if (!GENERATORS[generator]) continue // drop unknown/invalid generators
    const seedNum = Number(item?.seed)
    ideas.push({
      name: String(item?.name || GENERATORS[generator].label).slice(0, 40),
      description: String(item?.description || '').slice(0, 160),
      generator,
      params: sanitizeParams(generator, item?.params || {}),
      seed: Number.isFinite(seedNum) ? (seedNum >>> 0) : randomSeed(),
    })
    if (ideas.length >= MAX_IDEAS) break
  }
  return ideas
}
