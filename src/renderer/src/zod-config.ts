import { z } from 'zod'

// Строгий CSP запрещает eval/new Function — отключаем JIT-компиляцию схем zod
z.config({ jitless: true })
