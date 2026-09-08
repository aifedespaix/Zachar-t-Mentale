import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { startCircularThemeTransition } from '../theme/circularReveal'

export function ThemeToggleButton() {
  const resolvedTheme = useResolvedTheme()
  const setThemeMode = useAppearanceSettingsStore(s => s.setThemeMode)
  const label = resolvedTheme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={label}
            onClick={e => {
              const target = resolvedTheme === 'dark' ? 'light' : 'dark'
              startCircularThemeTransition({
                x: e.clientX,
                y: e.clientY,
                apply: () => {
                  void setThemeMode(target)
                },
              })
            }}
          >
            {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
