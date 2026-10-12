import './zod-config'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { api } from './api'
import { initI18n } from './i18n'
import { useUi } from './store/ui'
import './styles/index.css'

async function bootstrap(): Promise<void> {
  const [config, info] = await Promise.all([api.config.get(), api.app.info()])
  await initI18n(config.language)
  useUi.getState().init(config, info)
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
