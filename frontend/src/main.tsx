import {createRoot} from 'react-dom/client';
import App from './AppRouter.tsx';
import './index.css';
import { AuthProvider } from './lib/auth';

document.body.classList.add('talk-application');

createRoot(document.getElementById('root')!).render(<AuthProvider><App /></AuthProvider>);
