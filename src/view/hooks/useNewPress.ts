import { useEffect, useRef } from 'react'

/**
 * Calls `onPress` each time the press counter `n` changes after mount. The value at mount counts as already
 * handled, so a component remounted under a counter that was pressed before (a plan switch) does not fire.
 */
export function useNewPress(n: number, onPress: () => void): void {
  const handled = useRef(n)
  const press = useRef(onPress)
  useEffect(() => {
    press.current = onPress
  })
  useEffect(() => {
    if (n === handled.current) return
    handled.current = n
    press.current()
  }, [n])
}
