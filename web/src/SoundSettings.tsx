import { useEffect, useRef, useState } from 'react'
import { setAudio, sfx, useAudio } from './audio'

/** 標題列的「聲音」按鈕：總開關和三個聲道的音量。預設靜音 */
export function SoundSettings() {
  const { settings, manifest } = useAudio()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const hasBgm = Object.keys(manifest.bgm).length > 0
  const hasVoice = manifest.voice.length > 0

  // 點面板外面或按 Esc 關掉
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const slider = (key: 'bgm' | 'sfx' | 'voice', label: string, ready: boolean) => (
    <label className="sound-row">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(settings[key] * 100)}
        disabled={!settings.enabled || !ready}
        onChange={(e) => setAudio({ [key]: Number(e.target.value) / 100 })}
        onPointerUp={() => key === 'sfx' && sfx('correct')} // 調完音效音量時試聽一下
      />
      {!ready && <small>製作中</small>}
    </label>
  )

  return (
    <div className="sound" ref={ref}>
      <button
        className="ghost small"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={settings.enabled ? '聲音：開' : '聲音：關'}
        title="聲音"
      >
        {settings.enabled ? '🔊' : '🔇'}
      </button>
      {open && (
        <div className="sound-panel" role="dialog" aria-label="聲音">
          <label className="sound-row sound-master">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => {
                setAudio({ enabled: e.target.checked })
                if (e.target.checked) sfx('correct')
              }}
            />
            <span>開啟聲音</span>
          </label>
          {slider('sfx', '音效', true)}
          {slider('bgm', '音樂', hasBgm)}
          {slider('voice', '語音', hasVoice)}
          <p className="sound-note">音樂只在角色模式播放，模擬考時不播。音樂和語音由 AI 生成。</p>
        </div>
      )}
    </div>
  )
}
