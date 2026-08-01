// Shows the unprocessed image(s) an AI returned, so you can see what the model
// drew BEFORE the downscale + quantize pipeline pixelizes it — with a button to
// save each as a full-resolution PNG. `items` = [{ label, preview }] where each
// preview is a lightweight `rawToPreview` descriptor ({ url, width, height,
// provider }). The url is a PNG data-URL used for both the thumbnail and the
// download, so no multi-MB pixel buffer is held in React state/props.
export function RawAIPreview({ items, hint = 'Raw AI image (before the app pixelizes it):' }) {
  const shots = (items || []).filter(it => it?.preview?.url)
  if (!shots.length) return null
  return (
    <div className="ai-raw-preview">
      <div className="ai-hint">{hint}</div>
      <div className="ai-raw-row">
        {shots.map(({ label, preview }) => (
          <figure className="ai-raw-shot" key={label}>
            <img className="ai-raw-thumb" src={preview.url} alt={`raw ${label}`} />
            <div className="ai-raw-meta">
              <figcaption className="ai-raw-cap">{label} · {preview.width}×{preview.height}</figcaption>
              <a
                className="ai-preset-chip ai-raw-dl"
                href={preview.url}
                download={`ai-raw-${label.toLowerCase()}-${preview.provider}-${preview.width}x${preview.height}.png`}
              >
                Download PNG
              </a>
            </div>
          </figure>
        ))}
      </div>
    </div>
  )
}
