import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createDevAiKey,
  deleteDevAiKey,
  getAiLimits,
  listDevAiKeys,
  listDevAiTriage,
  updateDevAiKey,
  type AiLimitsResponse,
  type AiTriageItem,
  type DevAiKeySummary,
} from '../../api/ai'

interface DevAiPanelProps {
  onToast: (msg: string) => void
}

export function DevAiPanel({ onToast }: DevAiPanelProps) {
  const [keys, setKeys] = useState<DevAiKeySummary[]>([])
  const [limits, setLimits] = useState<AiLimitsResponse | null>(null)
  const [triage, setTriage] = useState<AiTriageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('deepseek-chat')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [weight, setWeight] = useState(1)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [k, l, t] = await Promise.all([
        listDevAiKeys(),
        getAiLimits(),
        listDevAiTriage(),
      ])
      setKeys(k)
      setLimits(l)
      setTriage(t)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const handleAddKey = async (e: FormEvent) => {
    e.preventDefault()
    if (!label.trim() || !apiKey.trim()) return
    try {
      const created = await createDevAiKey({
        label: label.trim(),
        api_key: apiKey.trim(),
        model: model.trim() || 'deepseek-chat',
        base_url: baseUrl.trim() || 'https://api.deepseek.com',
        weight,
      })
      setKeys((prev) => [created, ...prev])
      setLabel('')
      setApiKey('')
      onToast(`API Key "${created.label}" added to multi-key pool`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to add API key')
    }
  }

  return (
    <div className="dev-section" style={{ display: 'grid', gap: '1.25rem' }}>
      {error && <div className="dev-error-banner">{error}</div>}

      <form className="dev-duty-form" onSubmit={(e) => void handleAddKey(e)}>
        <h3>Multi-Key Pool (DeepSeek v4.1 Flash)</h3>
        <p className="dev-muted">
          Tambahkan beberapa API key untuk load-balancing (weighted round-robin) dan failover otomatis saat kena rate limit.
        </p>
        <div className="dev-duty-row">
          <label>
            Label
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. DeepSeek Key #1"
              required
            />
          </label>
          <label>
            Weight (1-100)
            <input
              type="number"
              min={1}
              max={100}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value) || 1)}
            />
          </label>
        </div>
        <div className="dev-duty-row">
          <label>
            Model
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek-chat"
            />
          </label>
          <label>
            Base URL
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com"
            />
          </label>
        </div>
        <label>
          API Key (disimpan server-side, hanya preview yang ditampilkan)
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            required
          />
        </label>
        <button type="submit" className="btn-primary">
          Add API Key
        </button>
      </form>

      <div>
        <h3>Active Keys ({keys.length})</h3>
        {loading && keys.length === 0 ? (
          <p className="dev-muted">Loading AI keys...</p>
        ) : keys.length === 0 ? (
          <p className="dev-muted">Belum ada API key terdaftar.</p>
        ) : (
          <div className="dev-table-wrap">
            <table className="dev-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Preview</th>
                  <th>Model</th>
                  <th>Weight</th>
                  <th>Req / Tokens</th>
                  <th>Errors</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td><strong>{k.label}</strong></td>
                    <td><code>{k.key_preview}</code></td>
                    <td><code>{k.model}</code></td>
                    <td>{k.weight}</td>
                    <td>
                      {k.total_requests.toLocaleString()} req
                      <div className="dev-muted">
                        in {k.total_input_tokens.toLocaleString()} · out {k.total_output_tokens.toLocaleString()}
                      </div>
                    </td>
                    <td>{k.error_count}</td>
                    <td>
                      <span className={`dev-status-pill ${k.is_active ? 'ok' : 'danger'}`}>
                        {k.is_active ? (k.cooldown_until ? 'COOLDOWN' : 'ACTIVE') : 'DISABLED'}
                      </span>
                    </td>
                    <td className="dev-actions-cell">
                      <button
                        type="button"
                        className="btn-xs"
                        onClick={async () => {
                          const updated = await updateDevAiKey(k.id, { is_active: !k.is_active })
                          setKeys((prev) => prev.map((x) => (x.id === k.id ? updated : x)))
                          onToast(`${k.label} ${updated.is_active ? 'enabled' : 'disabled'}`)
                        }}
                      >
                        {k.is_active ? 'Disable' : 'Enable'}
                      </button>
                      {k.cooldown_until && (
                        <button
                          type="button"
                          className="btn-xs"
                          onClick={async () => {
                            const updated = await updateDevAiKey(k.id, { clear_cooldown: true })
                            setKeys((prev) => prev.map((x) => (x.id === k.id ? updated : x)))
                            onToast(`Cooldown cleared for ${k.label}`)
                          }}
                        >
                          Clear Cooldown
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-xs btn-danger"
                        onClick={async () => {
                          await deleteDevAiKey(k.id)
                          setKeys((prev) => prev.filter((x) => x.id !== k.id))
                          onToast(`Deleted ${k.label}`)
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {limits && (
        <div>
          <h3>Batas Add-On &amp; Kuota ({limits.pricing.model_name})</h3>
          <p className="dev-muted">
            Ref Pricing: Input Cache Hit ${limits.pricing.input_cache_hit_per_1m_usd[0]}–${limits.pricing.input_cache_hit_per_1m_usd[1]}/1M ·
            Cache Miss ${limits.pricing.input_cache_miss_per_1m_usd[0]}–${limits.pricing.input_cache_miss_per_1m_usd[1]}/1M ·
            Output ${limits.pricing.output_per_1m_usd[0]}–${limits.pricing.output_per_1m_usd[1]}/1M ·
            ASR ${limits.pricing.asr_per_hour_usd}/jam · OCR ${limits.pricing.ocr_per_1k_pages_usd}/1k hal ·
            Concurrency {limits.pricing.concurrency_limit}
          </p>
          <div className="dev-table-wrap">
            <table className="dev-table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>AI Req / Hari</th>
                  <th>Semantic Search / Hari</th>
                  <th>Max Input / Output</th>
                  <th>Voice ASR / Bln</th>
                  <th>OCR / Bln</th>
                  <th>Web Search / Bln</th>
                </tr>
              </thead>
              <tbody>
                {limits.tiers.map((t) => (
                  <tr key={t.tier}>
                    <td><strong>{t.tier.toUpperCase()}</strong></td>
                    <td>{t.daily_ai_requests.toLocaleString()}</td>
                    <td>{t.daily_semantic_searches.toLocaleString()}</td>
                    <td>{t.max_input_tokens_per_req.toLocaleString()} / {t.max_output_tokens_per_req.toLocaleString()}</td>
                    <td>{t.monthly_asr_minutes} mnt</td>
                    <td>{t.monthly_ocr_pages} hal</td>
                    <td>{t.monthly_web_search_requests} req</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h3>AI Auto-Triage Reports ({triage.length})</h3>
        {triage.length === 0 ? (
          <p className="dev-muted">Belum ada hasil auto-triage AI.</p>
        ) : (
          <div className="dev-table-wrap">
            <table className="dev-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Toxicity / Spam</th>
                  <th>Summary</th>
                  <th>Recommended</th>
                </tr>
              </thead>
              <tbody>
                {triage.map((item) => (
                  <tr key={item.report_id}>
                    <td><code>{item.category}</code></td>
                    <td>
                      {(item.toxicity_score * 100).toFixed(0)}% / {(item.spam_score * 100).toFixed(0)}%
                    </td>
                    <td>{item.summary}</td>
                    <td><strong>{item.recommended_action}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
