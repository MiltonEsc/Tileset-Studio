import { useState, useRef, useEffect } from 'react'
import { Btn } from '../ui/Btn.jsx'
import { Section } from '../ui/Section.jsx'
import { Segmented } from '../ui/Segmented.jsx'
import { PixIcon } from '../ui/PixIcon.jsx'
import { ICONS } from '../ui/icons.js'
import { generateText } from '../../core/aiText.js'
import {
  validateTileJson,
  validateSeamlessEdges,
  enforceSeamlessEdges,
  exportTileJson,
  downloadTileJson,
  copyTileJson,
  matrixToPixels,
  createPaletteFromPixels
} from '../../core/jsonTileCodec.js'

export function JsonImportExport({ drawing, tileSize, setTileSize }) {
  const [dragHover, setDragHover] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [validationResult, setValidationResult] = useState(null)
  
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  const fileInputRef = useRef(null)

  // Sync parent tileSize if undo/redo changes the underlying pixel array size
  useEffect(() => {
    if (!drawing || !drawing.pixels) return
    const actualSize = Math.round(Math.sqrt(drawing.pixels.length / 4))
    if (actualSize && actualSize !== tileSize && setTileSize) {
      setTileSize(actualSize)
    }
  }, [drawing?.pixels?.length, tileSize, setTileSize])

  const processJson = (jsonStr) => {
    const res = validateTileJson(jsonStr)
    if (!res.valid) {
      setValidationResult({ success: false, errors: res.errors })
      return null
    }
    const seamlessRes = validateSeamlessEdges(res.tile.data)
    setValidationResult({
      success: true,
      tile: res.tile,
      seamless: seamlessRes.valid,
      seamlessErrors: seamlessRes.errors
    })
    return res.tile
  }

  const handlePasteChange = (e) => {
    const txt = e.target.value
    setPasteText(txt)
    if (txt.trim()) {
      processJson(txt)
    } else {
      setValidationResult(null)
    }
  }

  const doImport = (tile) => {
    const pixels = matrixToPixels(tile.data, tile.palette)
    if (tile.size !== tileSize && setTileSize) {
      setTileSize(tile.size)
    }
    drawing.loadPixels(pixels, tile.size)
    setModalOpen(false)
    setPasteText('')
    setValidationResult(null)
  }

  const handleFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const tile = processJson(e.target.result)
      if (tile) {
        setModalOpen(true) // Open modal to show seamless warnings if any, or just import
        // Alternatively, if it's perfectly valid and seamless, just import it immediately.
        // Let's open modal to show the validation state so user can confirm or fix.
      } else {
        setModalOpen(true)
      }
    }
    reader.readAsText(file)
  }

  const handleExport = () => {
    const jsonStr = exportTileJson("custom-tile", drawing.committedPixels, tileSize)
    downloadTileJson(jsonStr, "custom-tile", tileSize)
  }

  const handleCopy = async () => {
    const jsonStr = exportTileJson("custom-tile", drawing.committedPixels, tileSize)
    await copyTileJson(jsonStr)
    alert("JSON copied to clipboard!")
  }
  
  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setAiError('')
    try {
      const systemPrompt = `You are an expert pixel art AI.
Return ONLY valid JSON. Do NOT include markdown code blocks.
The JSON must follow this precise schema:
{
  "version": 1,
  "type": "pixel-tile",
  "name": "a descriptive name based on the prompt",
  "size": ${tileSize},
  "width": ${tileSize},
  "height": ${tileSize},
  "palette": ["#RRGGBB", ...], // Up to 12 colors
  "data": [[0, 1, ...], ...] // 2D array of integers (${tileSize}x${tileSize}). Each integer is an index in the palette.
}
Ensure the tile is visually interesting, repeats seamlessly (the top edge matches the bottom edge, left matches right), and fits the prompt.
The dimensions must be exactly ${tileSize}x${tileSize}.
Do not output anything else but the raw JSON.`

      // "gemini-3.5-flash" matches the AI suggestion for general fast tasks
      const text = await generateText({ prompt: aiPrompt, system: systemPrompt, model: 'gemini-3.5-flash' })
      const cleanText = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      
      const res = validateTileJson(cleanText)
      if (!res.valid) {
        setAiError('Generated JSON was invalid: ' + res.errors.join(', '))
        return
      }
      
      const tile = res.tile
      if (tile.size !== tileSize && setTileSize) {
        setTileSize(tile.size)
      }
      const pixels = matrixToPixels(tile.data, tile.palette)
      drawing.loadPixels(pixels, tile.size)
      setAiModalOpen(false)
      setAiPrompt('')
    } catch (err) {
      setAiError(err.message || 'Generation failed.')
    } finally {
      setAiLoading(false)
    }
  }

  const handleFixEdges = () => {
    if (validationResult?.success && validationResult.tile) {
      const fixedData = enforceSeamlessEdges(validationResult.tile.data)
      const fixedTile = { ...validationResult.tile, data: fixedData }
      const seamlessRes = validateSeamlessEdges(fixedData)
      setValidationResult({
        ...validationResult,
        tile: fixedTile,
        seamless: seamlessRes.valid,
        seamlessErrors: seamlessRes.errors
      })
    }
  }
  
  const handleFixEdgesCanvas = () => {
    const { palette, data } = createPaletteFromPixels(drawing.committedPixels, tileSize)
    const fixedData = enforceSeamlessEdges(data)
    const pixels = matrixToPixels(fixedData, palette)
    drawing.loadPixels(pixels, tileSize)
  }

  const { palette: currentPalette, data: currentData } = createPaletteFromPixels(drawing.committedPixels, tileSize)
  const currentSeamless = validateSeamlessEdges(currentData).valid

  return (
    <Section title="JSON Import/Export" icon="code">
      <div 
        className={`drop-zone ${dragHover ? 'hover' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragHover(true) }}
        onDragLeave={() => setDragHover(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragHover(false)
          handleFile(e.dataTransfer.files[0])
        }}
        style={{
          border: '2px dashed var(--border)',
          borderRadius: 6,
          padding: 16,
          textAlign: 'center',
          marginBottom: 12,
          color: 'var(--ink-dim)'
        }}
      >
        Drop JSON file here
      </div>
      
      <div className="row-btns">
        <Btn size="sm" variant="outline" icon="upload" full onClick={() => setModalOpen(true)}>Paste JSON</Btn>
        <Btn size="sm" variant="outline" icon="upload" full onClick={() => fileInputRef.current?.click()}>File JSON</Btn>
        <input type="file" ref={fileInputRef} accept=".json" style={{display: 'none'}} onChange={(e) => handleFile(e.target.files[0])} />
      </div>
      <div className="row-btns" style={{ marginTop: 8 }}>
        <Btn size="sm" variant="outline" icon="download" full onClick={handleExport}>Export JSON</Btn>
        <Btn size="sm" variant="outline" icon="copy" full onClick={handleCopy}>Copy JSON</Btn>
      </div>
      <div className="row-btns" style={{ marginTop: 8 }}>
        <Btn size="sm" variant="outline" icon="spark" full onClick={() => setAiModalOpen(true)}>Generate with AI</Btn>
      </div>

      <div style={{ marginTop: 12, padding: 8, background: 'var(--bg-inset)', borderRadius: 4, fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span>Size:</span>
          <div style={{ width: '160px' }}>
            <Segmented
              full
              size="sm"
              value={tileSize}
              onChange={(sz) => {
                const s = parseInt(sz, 10)
                drawing.resizeCanvas(s)
                setTileSize(s)
              }}
              options={[
                { value: 8, label: '8' },
                { value: 16, label: '16' },
                { value: 32, label: '32' },
                { value: 64, label: '64' }
              ]}
            />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span>Seamless:</span>
          <b style={{ color: currentSeamless ? 'var(--accent-success)' : 'var(--accent-warning)' }}>
            {currentSeamless ? 'Válido' : 'Inválido'}
          </b>
        </div>
        {!currentSeamless && (
          <Btn size="sm" variant="outline" full onClick={handleFixEdgesCanvas}>Fix seamless edges</Btn>
        )}
      </div>
      
      {modalOpen && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="modal-content" style={{
            background: 'var(--bg)',
            padding: 24,
            borderRadius: 8,
            width: 500,
            maxWidth: '90vw',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: 18 }}>Import JSON Tile</h2>
            
            <textarea 
              value={pasteText}
              onChange={handlePasteChange}
              placeholder="Paste JSON here..."
              style={{
                width: '100%',
                height: 150,
                fontFamily: 'monospace',
                padding: 8,
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--bg-inset)',
                color: 'var(--ink)',
                marginBottom: 16
              }}
            />
            
            {validationResult && (
              <div style={{
                padding: 12,
                borderRadius: 4,
                marginBottom: 16,
                background: validationResult.success 
                  ? (validationResult.seamless ? 'var(--bg-success)' : 'var(--bg-warning)') 
                  : 'var(--bg-danger)',
                border: '1px solid',
                borderColor: validationResult.success 
                  ? (validationResult.seamless ? 'var(--accent-success)' : 'var(--accent-warning)') 
                  : 'var(--accent-danger)',
              }}>
                {validationResult.success ? (
                  <>
                    <h4 style={{ margin: '0 0 8px 0', color: validationResult.seamless ? 'var(--accent-success)' : 'var(--accent-warning)' }}>
                      JSON Válido
                    </h4>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                      <li>Nombre: {validationResult.tile.name}</li>
                      <li>Tamaño: {validationResult.tile.size}x{validationResult.tile.size}</li>
                      <li>Colores: {validationResult.tile.palette.length}</li>
                      <li>
                        Seamless: {validationResult.seamless ? 'Válido' : 'No es completamente repetible'}
                      </li>
                    </ul>
                    {!validationResult.seamless && (
                      <div style={{ marginTop: 12 }}>
                        <p style={{ margin: '0 0 8px 0', fontSize: 13 }}>Se encontraron:</p>
                        <ul style={{ margin: '0 0 12px 0', paddingLeft: 20, fontSize: 13 }}>
                          {validationResult.seamlessErrors.map((err, i) => <li key={i}>{err.message}</li>)}
                        </ul>
                        <Btn size="sm" variant="outline" onClick={handleFixEdges}>Fix seamless edges</Btn>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <h4 style={{ margin: '0 0 8px 0', color: 'var(--accent-danger)' }}>No se pudo importar el JSON</h4>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--accent-danger)' }}>
                      {validationResult.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <Btn variant="outline" onClick={() => { setModalOpen(false); setPasteText(''); setValidationResult(null) }}>Cancel</Btn>
              <Btn 
                variant="primary" 
                disabled={!validationResult?.success}
                onClick={() => validationResult?.success && doImport(validationResult.tile)}
              >
                {validationResult?.success && !validationResult.seamless ? 'Import anyway' : 'Import'}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {aiModalOpen && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="modal-content" style={{
            background: 'var(--bg)',
            padding: 24,
            borderRadius: 8,
            width: 400,
            maxWidth: '90vw',
          }}>
            <h2 style={{ margin: '0 0 8px 0', fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              <PixIcon name="spark" /> AI JSON Tile
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--ink-dim)' }}>
              Describe a seamless tile (e.g. "lava rocks", "water"). Gemini will generate the JSON directly.
            </p>
            
            <textarea 
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="A magical forest floor with glowing mushrooms..."
              disabled={aiLoading}
              style={{
                width: '100%',
                height: 100,
                fontFamily: 'inherit',
                padding: 12,
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--bg-inset)',
                color: 'var(--ink)',
                marginBottom: 16
              }}
            />
            
            {aiError && (
              <div style={{ padding: 12, borderRadius: 4, background: 'var(--bg-danger)', color: 'var(--accent-danger)', fontSize: 13, marginBottom: 16 }}>
                {aiError}
              </div>
            )}
            
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <Btn variant="outline" onClick={() => { setAiModalOpen(false); setAiPrompt(''); setAiError('') }} disabled={aiLoading}>Cancel</Btn>
              <Btn variant="primary" onClick={handleAIGenerate} disabled={aiLoading || !aiPrompt.trim()}>
                {aiLoading ? 'Generating...' : 'Generate Tile'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}
