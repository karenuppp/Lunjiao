import { useState, useEffect, useCallback } from 'react'
import './TourBubble.css'

export interface TourStepConfig {
  targetSelector: string
  content: string
  placement?: 'bottom' | 'top'
}

interface TourBubbleProps {
  step: TourStepConfig
  stepIndex: number
  totalSteps: number
  onNext: () => void
  onClose: () => void
  nextLabel?: string
  showNext?: boolean
}

export default function TourBubble({
  step, stepIndex, totalSteps,
  onNext, onClose,
  nextLabel = '下一步',
  showNext = true,
}: TourBubbleProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [visible, setVisible] = useState(false)

  const calcPosition = useCallback(() => {
    const target = document.querySelector(step.targetSelector) as HTMLElement | null
    if (!target) return
    const rect = target.getBoundingClientRect()
    const bubbleWidth = 320
    const placement = step.placement || 'bottom'

    let top: number, left: number
    if (placement === 'bottom') {
      top = rect.bottom + 12
      left = rect.left + rect.width / 2 - bubbleWidth / 2
    } else {
      top = rect.top - 12
      left = rect.left + rect.width / 2 - bubbleWidth / 2
    }

    left = Math.max(16, Math.min(left, window.innerWidth - bubbleWidth - 16))
    if (placement === 'top') {
      top = Math.max(16, top)
    }

    setPos({ top, left })
  }, [step])

  useEffect(() => {
    const t = setTimeout(calcPosition, 100)
    const t2 = setTimeout(() => setVisible(true), 150)
    window.addEventListener('resize', calcPosition)
    return () => {
      clearTimeout(t)
      clearTimeout(t2)
      window.removeEventListener('resize', calcPosition)
    }
  }, [calcPosition, step])

  const isLast = stepIndex + 1 >= totalSteps
  const nextLabelComputed = isLast ? '完成' : nextLabel

  if (!pos) return null

  return (
    <div
      className={`tour-bubble-overlay ${visible ? 'tour-bubble--visible' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains('tour-bubble-overlay')) {
          onClose()
        }
      }}
    >
      <div
        className="tour-bubble"
        style={{
          top: pos.top,
          left: pos.left,
        }}
      >
        <div className="tour-bubble-arrow" />
        <div className="tour-bubble-body">
          <div className="tour-bubble-step">
            步骤 {stepIndex + 1} / {totalSteps}
          </div>
          <div className="tour-bubble-text">{step.content}</div>
          <div className="tour-bubble-actions">
            <button className="tour-bubble-close" onClick={onClose}>
              跳过
            </button>
            {showNext && (
              <button className="tour-bubble-next" onClick={onNext}>
                {nextLabelComputed}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
