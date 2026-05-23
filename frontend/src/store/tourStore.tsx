import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TourStepConfig } from '../components/TourBubble'

const NORMAL_USER_STEPS: (TourStepConfig & { path: string })[] = [
  {
    path: '/chat',
    targetSelector: '.template-selector-row',
    content: '1.如果你选择了提示词模板，小助理会优先查询对应场景的经验和知识。',
    placement: 'bottom',
  },
  {
    path: '/knowledge-base',
    targetSelector: '.scope-toggle',
    content: '2.你上传的文件会到达个人知识库，还有管理员共享给你的公共知识库哦。',
    placement: 'bottom',
  },
]

const ADMIN_STEPS: (TourStepConfig & { path: string })[] = [
  {
    path: '/admin/users',
    targetSelector: '.perm-section',
    content: '1.你可以修改该用户查询的知识库和数据库范围，还可以设置他的话语是否会影响助理的成长。',
    placement: 'bottom',
  },
  {
    path: '/admin/prompt',
    targetSelector: '.system-prompt-label',
    content: '2.你可以修改每个提示词模板，提示词会影响助理的查询方向哦。',
    placement: 'bottom',
  },
  {
    path: '/admin/experience',
    targetSelector: '.exp-detail-header',
    content: '3.如果助理学到的经验不准确，你可以修改或删除。',
    placement: 'bottom',
  },
]

interface TourContextValue {
  tourActive: boolean
  currentStep: number
  steps: (TourStepConfig & { path: string })[]
  currentStepConfig: TourStepConfig | null
  startTour: (isAdmin: boolean) => void
  nextStep: () => void
  closeTour: () => void
}

const TourContext = createContext<TourContextValue>({
  tourActive: false,
  currentStep: 0,
  steps: [],
  currentStepConfig: null,
  startTour: () => {},
  nextStep: () => {},
  closeTour: () => {},
})

export function TourProvider({ children, role }: { children: ReactNode; role: string }) {
  const navigate = useNavigate()
  const isAdmin = role === 'admin'
  const defaultSteps = isAdmin ? ADMIN_STEPS : NORMAL_USER_STEPS

  const [tourActive, setTourActive] = useState(false)
  const [steps, setSteps] = useState<(TourStepConfig & { path: string })[]>(defaultSteps)
  const [currentStep, setCurrentStep] = useState(0)

  const startTour = useCallback((admin: boolean) => {
    const s = admin ? ADMIN_STEPS : NORMAL_USER_STEPS
    setSteps(s)
    setCurrentStep(0)
    setTourActive(true)
    navigate(s[0].path, { replace: true })
  }, [navigate])

  const nextStep = useCallback(() => {
    const next = currentStep + 1
    if (next >= steps.length) {
      setTourActive(false)
      setCurrentStep(0)
      return
    }
    setCurrentStep(next)
    navigate(steps[next].path, { replace: true })
  }, [currentStep, steps, navigate])

  const closeTour = useCallback(() => {
    setTourActive(false)
    setCurrentStep(0)
  }, [])

  const currentStepConfig = tourActive ? steps[currentStep] ?? null : null

  return (
    <TourContext.Provider value={{
      tourActive, currentStep, steps,
      currentStepConfig,
      startTour, nextStep, closeTour,
    }}>
      {children}
    </TourContext.Provider>
  )
}

export function useTour() {
  return useContext(TourContext)
}
