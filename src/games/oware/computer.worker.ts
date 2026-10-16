// The computer thinks here, off the main thread, so the board stays smooth while it does.
import type { OwareState } from '../../../supabase/functions/_shared/oware'
import { choosePit, type Level } from './computer'

type Request = { id: number; state: OwareState; level: Level }

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, state, level } = event.data
  self.postMessage({ id, pit: choosePit(state, level) })
}
