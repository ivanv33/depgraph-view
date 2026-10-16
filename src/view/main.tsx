import '@fontsource-variable/instrument-sans'
import './viewer.css'
import { createRoot } from 'react-dom/client'
import ViewerPage from './ViewerPage.js'

// No StrictMode: a layout is computed once per change, as in the app.
createRoot(document.getElementById('root')!).render(<ViewerPage />)
