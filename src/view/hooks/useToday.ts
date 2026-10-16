import { useEffect, useState } from 'react'
import { localDate } from '../../engine/due.js'

/** Today's local date, refreshed when it changes (checked once a minute). */
export function useToday(): string {
  const [today, setToday] = useState(() => localDate(new Date()))
  useEffect(() => {
    const id = setInterval(() => setToday(localDate(new Date())), 60_000)
    return () => clearInterval(id)
  }, [])
  return today
}
