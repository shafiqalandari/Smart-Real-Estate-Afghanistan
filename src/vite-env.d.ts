/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_CENTRAL_API_URL?: string
  readonly VITE_CENTRAL_ACCESS_ENABLED?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
