import { useState, type FormEvent } from 'react'
import {
  catchMeUpChannel,
  runAiSlashCommand,
  semanticSearchAi,
  transcribeVoiceNotes,
  type AiSlashCommandResponse,
  type CatchMeUpResponse,
  type SemanticSearchResult,
  type VoiceTranscribeResponse,
} from '../../api/ai'

interface AiAssistantBarProps {
  channelId: string
  onNotify: (text: string) => void
}

type ActiveTool = 'none' | 'catchup' | 'search' | 'command' | 'voice'

export function AiAssistantBar({ channelId, onNotify }: AiAssistantBarProps) {
  const [tool, setTool] = useState<ActiveTool>('none')
  const [busy, setBusy] = useState(false)

  const [catchup, setCatchup] = useState<CatchMeUpResponse | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SemanticSearchResult[]>([])
  const [slashCmd, setSlashCmd] = useState<'ai' | 'ask' | 'summarize' | 'translate' | 'code'>('ai')
  const [slashPrompt, setSlashPrompt] = useState('')
  const [slashRes, setSlashRes] = useState<AiSlashCommandResponse | null>(null)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceNotes, setVoiceNotes] = useState<VoiceTranscribeResponse | null>(null)

  const handleCatchMeUp = async () => {
    setTool('catchup')
    setBusy(true)
    try {
      const res = await catchMeUpChannel(channelId)
      setCatchup(res)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to summarize channel.')
    } finally {
      setBusy(false)
    }
  }

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return
    setBusy(true)
    try {
      const res = await semanticSearchAi(searchQuery.trim(), channelId)
      setSearchResults(res)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Gagal mencari pesan')
    } finally {
      setBusy(false)
    }
  }

  const handleSlash = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await runAiSlashCommand(channelId, slashCmd, slashPrompt.trim(), true)
      setSlashRes(res)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Gagal menjalankan AI command')
    } finally {
      setBusy(false)
    }
  }

  const handleVoiceNotes = async (e: FormEvent) => {
    e.preventDefault()
    if (!voiceTranscript.trim()) return
    setBusy(true)
    try {
      const res = await transcribeVoiceNotes({
        channel_id: channelId,
        duration_secs: Math.max(60, Math.ceil(voiceTranscript.trim().length / 10)),
        transcript_text: voiceTranscript.trim(),
      })
      setVoiceNotes(res)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Gagal membuat notulensi voice')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="ai-assistant-bar"
      style={{
        display: 'grid',
        gap: '0.5rem',
        padding: '0.5rem 0.9rem',
        borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
        fontSize: '0.85rem',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
        <button type="button" className="btn-xs" onClick={() => void handleCatchMeUp()} disabled={busy}>
          Catch Me Up
        </button>
        <button
          type="button"
          className="btn-xs"
          onClick={() => setTool(tool === 'search' ? 'none' : 'search')}
        >
          Smart Search
        </button>
        <button
          type="button"
          className="btn-xs"
          onClick={() => setTool(tool === 'command' ? 'none' : 'command')}
        >
          /ai Command
        </button>
        <button
          type="button"
          className="btn-xs"
          onClick={() => setTool(tool === 'voice' ? 'none' : 'voice')}
        >
          Voice Notes
        </button>
        {tool !== 'none' && (
          <button type="button" className="btn-xs" onClick={() => setTool('none')}>
            Close
          </button>
        )}
      </div>

      {tool === 'catchup' && (
        <div style={{ padding: '0.5rem', borderRadius: '8px', background: 'var(--bg-raised, rgba(255,255,255,0.04))' }}>
          {busy ? (
            <span>Summarizing conversation...</span>
          ) : catchup ? (
            <div>
              <strong>
                Catch Me Up ({catchup.message_count} pesan · seq {catchup.from_seq}–{catchup.to_seq}
                {catchup.cached ? ' · cached' : ''})
              </strong>
              <p style={{ margin: '0.35rem 0' }}>{catchup.summary}</p>
              {catchup.highlights.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {catchup.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}

      {tool === 'search' && (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <form onSubmit={(e) => void handleSearch(e)} style={{ display: 'flex', gap: '0.4rem' }}>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari makna pesan, link desain, atau topik..."
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn-xs" disabled={busy}>
              Cari
            </button>
          </form>
          {searchResults.map((r) => (
            <div key={r.source_id} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', background: 'var(--bg-raised, rgba(255,255,255,0.04))' }}>
              <small style={{ opacity: 0.7 }}>
                {r.source_type} · score {r.score.toFixed(2)}
              </small>
              <div>{r.content_preview}</div>
            </div>
          ))}
        </div>
      )}

      {tool === 'command' && (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <form onSubmit={(e) => void handleSlash(e)} style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <select value={slashCmd} onChange={(e) => setSlashCmd(e.target.value as typeof slashCmd)}>
              <option value="ai">/ai</option>
              <option value="ask">/ask</option>
              <option value="summarize">/summarize</option>
              <option value="translate">/translate</option>
              <option value="code">/code</option>
            </select>
            <input
              type="text"
              value={slashPrompt}
              onChange={(e) => setSlashPrompt(e.target.value)}
              placeholder="Masukkan prompt AI..."
              style={{ flex: 1, minWidth: '180px' }}
            />
            <button type="submit" className="btn-xs" disabled={busy}>
              Jalankan
            </button>
          </form>
          {slashRes && (
            <pre style={{ margin: 0, padding: '0.5rem', borderRadius: '6px', whiteSpace: 'pre-wrap', background: 'var(--bg-raised, rgba(255,255,255,0.04))' }}>
              {slashRes.answer}
            </pre>
          )}
        </div>
      )}

      {tool === 'voice' && (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <form onSubmit={(e) => void handleVoiceNotes(e)} style={{ display: 'grid', gap: '0.4rem' }}>
            <textarea
              rows={2}
              value={voiceTranscript}
              onChange={(e) => setVoiceTranscript(e.target.value)}
              placeholder="Tempel transkrip voice channel untuk dirangkum menjadi Meeting Notes..."
            />
            <button type="submit" className="btn-xs" disabled={busy} style={{ justifySelf: 'start' }}>
              Buat Meeting Notes
            </button>
          </form>
          {voiceNotes && (
            <pre style={{ margin: 0, padding: '0.5rem', borderRadius: '6px', whiteSpace: 'pre-wrap', background: 'var(--bg-raised, rgba(255,255,255,0.04))' }}>
              {voiceNotes.meeting_notes}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
