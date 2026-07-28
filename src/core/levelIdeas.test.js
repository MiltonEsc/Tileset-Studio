import test from 'node:test'
import assert from 'node:assert/strict'
import { parseIdeas, buildIdeaSystemPrompt, buildIdeaUserPrompt } from './levelIdeas.js'
import { GENERATOR_PARAMS } from './levelGenerator.js'

test('parseIdeas accepts a JSON string and sanitizes params', () => {
  const raw = JSON.stringify({
    ideas: [
      { name: 'Deep Caverns', description: 'twisty caves', generator: 'caves', params: { density: 99, steps: 4 }, seed: 7 },
    ],
  })
  const ideas = parseIdeas(raw)
  assert.equal(ideas.length, 1)
  assert.equal(ideas[0].generator, 'caves')
  assert.equal(ideas[0].seed, 7)
  assert.equal(ideas[0].params.density, GENERATOR_PARAMS.caves[0].max) // clamped from 99
  assert.equal(ideas[0].params.steps, 4)
})

test('parseIdeas drops unknown generators and keeps valid ones', () => {
  const ideas = parseIdeas({
    ideas: [
      { generator: 'nope', name: 'x', params: {} },
      { generator: 'rooms', name: 'Vault', params: { roomCount: 5 } },
    ],
  })
  assert.equal(ideas.length, 1)
  assert.equal(ideas[0].generator, 'rooms')
  assert.equal(ideas[0].params.roomCount, 5)
})

test('parseIdeas fills a random seed when missing/invalid and caps at 6', () => {
  const one = parseIdeas({ ideas: [{ generator: 'random', name: 'r', params: {}, seed: 'xyz' }] })
  assert.equal(Number.isInteger(one[0].seed), true)
  const many = parseIdeas({ ideas: Array.from({ length: 10 }, () => ({ generator: 'caves', name: 'c', params: {} })) })
  assert.equal(many.length, 6)
})

test('parseIdeas tolerates a bare array and empty/garbage input', () => {
  assert.equal(parseIdeas({ ideas: [] }).length, 0)
  assert.equal(parseIdeas([{ generator: 'islands', name: 'i', params: {} }]).length, 1)
  assert.throws(() => parseIdeas('not json'))
})

test('buildIdeaSystemPrompt lists every generator with its param ranges; user prompt reflects theme', () => {
  const sys = buildIdeaSystemPrompt()
  assert.match(sys, /"caves"/)
  assert.match(sys, /"rooms"/)
  assert.match(sys, /density \(/)
  assert.match(buildIdeaUserPrompt('lava'), /lava/)
  assert.match(buildIdeaUserPrompt(''), /varied/)
})
