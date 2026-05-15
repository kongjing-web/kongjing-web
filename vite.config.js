import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc' // 刚才报错找不到的那个
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
})