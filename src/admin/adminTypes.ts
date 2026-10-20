export type AdminSession = { id: string; email: string; role: string; name?: string }
export type PageResult<T = any> = { rows: T[]; total: number; page: number; pageSize: number }
export type AdminSummary = { customers?: number; totalInstallations?: number; blocked?: number; trialActive?: number; activeAccess?: number; licensed?: number; expired?: number }
export type AdminPlan = { id: string; title: string; amount: number; currency: string; durationValue?: number; durationUnit?: string; description?: string; isActive?: boolean; isPopular?: boolean }
export type PaymentMethod = { id: string; title: string; instructions?: string; accountName?: string; accountNumber?: string; isActive?: boolean; sortOrder?: number }
