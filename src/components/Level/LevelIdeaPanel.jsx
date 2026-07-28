import { useState } from 'react'
import { Btn } from '../ui/Btn.jsx'
import { GridThumb } from './GridThumb.jsx'
import { useAIModel } from '../../hooks/useAIModel.js'
import { generateText, TEXT_MODELS } from '../../core/aiText.js'
import { buildIdeaSystemPrompt, buildIdeaUserPrompt, parseIdeas } from '../../core/levelIdeas.js'
import { GENERATORS } from '../../core/levelGenerator.js'
import { STORAGE_KEYS } from '../../constants/storageKeys.js'

// AI assistant: describe a theme → the model proposes level concepts as cards.
// Each card carries a generator + params, so clicking it generates the level
// deterministically (the model never emits the raw grid).
export function LevelIdeaPanel({ level }) {
  const [theme, setTheme] = useState('')
  const [ideas, setIdeas] = useState(null)
  const { model, setModel, loading, error, run, models } = useAIModel(TEXT_MODELS, STORAGE_KEYS.AI_TEXT_MODEL)

  const suggest = async () => {
    const result = await run(async () => {
      const raw = await generateText({
        prompt: buildIdeaUserPrompt(theme),
        system: buildIdeaSystemPrompt(),
        model,
      })
      // Pre-render each idea's preview grid once (with the current dimensions)
      // so cards don't regenerate on every render and survive a later resize.
      const w = level.width, h = level.height
      return parseIdeas(raw).map(idea => ({
        ...idea,
        w, h,
        grid: GENERATORS[idea.generator].fn(w, h, { ...idea.params, seed: idea.seed }),
      }))
    })
    if (result) setIdeas(result)
  }

  const applyIdea = (idea) => {
    level.generate(idea.generator, { ...idea.params, seed: idea.seed })
  }

  return (
    <div className="gen-panel">
      <div className="ai-hint">Describe a vibe and let the assistant propose level concepts. Click one to generate it.</div>
      <textarea
        className="text-input"
        rows={2}
        placeholder="e.g. flooded forest ruins, tight panic dungeon…"
        value={theme}
        onChange={e => setTheme(e.target.value)}
        disabled={loading}
      />
      <select className="text-input" value={model} onChange={e => setModel(e.target.value)} disabled={loading}>
        {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <Btn size="sm" variant="primary" icon="spark" full onClick={suggest} disabled={loading}>
        {loading ? 'Thinking…' : 'Suggest ideas'}
      </Btn>

      {error && <div className="ai-error">{error}</div>}
      {ideas && ideas.length === 0 && !error && <div className="ai-hint">No usable ideas came back — try again.</div>}

      {ideas && ideas.length > 0 && (
        <div className="idea-list">
          {ideas.map((idea, i) => (
            <button key={i} className="idea-card" onClick={() => applyIdea(idea)} title={`Generate "${idea.name}"`}>
              <div className="idea-thumb">
                <GridThumb grid={idea.grid} width={idea.w} height={idea.h} />
              </div>
              <div className="idea-body">
                <div className="idea-name">{idea.name}</div>
                <div className="idea-desc">{idea.description}</div>
                <div className="idea-meta">{GENERATORS[idea.generator].label}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
