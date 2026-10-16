import { useCallback, useEffect, useState } from 'react'

const KEY = 'depgraph.group'

/** Whether branches off the path to the selection are collapsed into decks. On by default; a browser that turns it off remembers 0, one that chose on keeps 1. */
export function useGrouping(): [boolean, () => void] {
  const [on, setOn] = useState(true)
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage only exists in the browser, so it is read after mount
      setOn(localStorage.getItem(KEY) !== '0')
    } catch {
      // storage can throw or be blocked: stay on
    }
  }, [])
  const toggle = useCallback(() => {
    setOn(prev => {
      try {
        localStorage.setItem(KEY, prev ? '0' : '1')
      } catch {
        // not remembered, still toggles
      }
      return !prev
    })
  }, [])
  return [on, toggle]
}
