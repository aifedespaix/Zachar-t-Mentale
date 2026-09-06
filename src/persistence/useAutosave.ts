import { useEffect, useRef } from 'react'
import type { Card } from '../types/card'
import { saveMindMap } from './fileStore'

export function useAutosave(path: string, cards: Card[], delayMs = 500): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      void saveMindMap(path, cards)
    }, delayMs)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [path, cards, delayMs])
}
