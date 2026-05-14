import { useEffect, useRef } from 'react'

/**
 * Listens for NUI messages from the client script matching the given action.
 * The handler ref is kept current so it never needs to appear in effect deps.
 */
export const useNuiEvent = <T = unknown>(action: string, handler: (data: T) => void) => {
    const savedHandler = useRef(handler)

    savedHandler.current = handler

    useEffect(() => {
        const listener = (event: MessageEvent) => {
            const { data } = event
            if (!data || typeof data !== 'object') return
            if (!('action' in data || 'name' in data)) return

            const eventAction = data.action ?? data.name
            const eventData = data.data as T

            if (eventAction === action) savedHandler.current(eventData)
        }

        window.addEventListener('message', listener)
        return () => window.removeEventListener('message', listener)
    }, [action])
}