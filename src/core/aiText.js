// AI text generation (chat/completion), reusing the same provider key
// resolution and dev proxies as the image path (aiTile.js). Used by the level
// "idea cards" assistant. Returns the raw model text (expected to be JSON).
import { GEMINI_BASE, OPENAI_BASE, resolveApiKey } from './aiTile.js'

export const TEXT_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini' },
  { id: 'gpt-4o-mini',      label: 'GPT-4o mini',      provider: 'openai' },
]

const DEFAULT_TEXT_MODEL = TEXT_MODELS[0].id

export function providerForTextModel(model) {
  return TEXT_MODELS.find(m => m.id === model)?.provider || 'gemini'
}

async function readError(res, provider) {
  let msg = `${provider === 'openai' ? 'OpenAI' : 'Gemini'} text request failed (HTTP ${res.status}).`
  try {
    const err = await res.json()
    if (err?.error?.message) msg = err.error.message
  } catch {
    // ignore
  }
  return msg
}

async function geminiText(apiKey, model, prompt, system, temperature) {
  const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { responseMimeType: 'application/json', temperature },
    }),
  })
  if (!res.ok) throw new Error(await readError(res, 'gemini'))
  const json = await res.json()
  const parts = json?.candidates?.[0]?.content?.parts || []
  return parts.map(p => p.text).filter(Boolean).join('')
}

async function openaiText(apiKey, model, prompt, system, temperature) {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature,
    }),
  })
  if (!res.ok) throw new Error(await readError(res, 'openai'))
  const json = await res.json()
  return json?.choices?.[0]?.message?.content || ''
}

// Resolves the provider from the model id, gets its key from .env.local, and
// returns the model's raw text response. Both providers are asked for JSON.
export async function generateText({ prompt, system = '', model = DEFAULT_TEXT_MODEL, temperature = 0.9 }) {
  const provider = providerForTextModel(model)
  const apiKey = resolveApiKey(provider)
  if (!apiKey) {
    const envVar = provider === 'openai' ? 'VITE_OPENAI_API_KEY' : 'VITE_GEMINI_API_KEY'
    throw new Error(`Missing ${envVar} in .env.local for the selected model.`)
  }
  const text = provider === 'openai'
    ? await openaiText(apiKey, model, prompt, system, temperature)
    : await geminiText(apiKey, model, prompt, system, temperature)
  if (!text) throw new Error('Empty response from the model.')
  return text
}
