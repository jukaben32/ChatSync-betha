import { createContext, useContext } from 'react'

export interface Me {
  role: 'admin' | 'agent' | 'api'
  name: string
  id: string | null
  ip?: string
}

export const MeContext = createContext<Me>({ role: 'admin', name: '', id: null })

/** Quién está usando el panel: define qué secciones se ven y con qué nombre se firman los mensajes. */
export const useMe = () => useContext(MeContext)
